/**
 * Groq API-based expense categorizer
 * Uses Groq's LLM models to intelligently categorize expenses
 * Falls back to manual keyword matching if LLM fails
 */

import OpenAI from 'openai';

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY;

// Initialize Groq client with OpenAI SDK
const groqClient = new OpenAI({
  apiKey: GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
  dangerouslyAllowBrowser: true, // Allow browser usage
});

/**
 * Manual fallback categorization using keyword matching
 * @param {string} text - Text to categorize
 * @param {Array} categories - Available categories
 * @returns {object} Categorization result
 */
function manualCategorizeByKeyword(text, categories = []) {
  const textLower = text.toLowerCase();
  
  // Define keyword patterns for each common category
  const patterns = {
    'Food': /food|eat|meal|restaurant|pizza|burger|lunch|breakfast|dinner|grocery|snack|chips|chocolate|coffee|tea/i,
    'Transport': /transport|taxi|uber|bus|metro|train|flight|car|bike|fuel|gas|parking|ride/i,
    'Shopping': /shop|buy|clothes|dress|shoes|shirt|pants|jacket|coat|bag|purchase/i,
    'Entertainment': /movie|cinema|game|concert|ticket|show|entertainment|party|fun/i,
    'Bills': /bill|electricity|water|phone|internet|rent|housing|utility|subscription|membership/i,
    'Healthcare': /hospital|doctor|medicine|medical|health|pharmacy|cure|treatment/i,
    'Skincare': /skincare|facewash|lotion|cream|soap|shampoo|conditioner|deodorant/i,
    'Other': /other|misc|miscellaneous/i
  };
  
  // Try to match with defined patterns
  for (const [categoryName, pattern] of Object.entries(patterns)) {
    if (pattern.test(textLower)) {
      // Check if this category exists in available categories
      const categoryExists = categories.some(c => c.name.toLowerCase() === categoryName.toLowerCase());
      if (categoryExists) {
        return {
          category: categoryName,
          confidence: 0.7,
          reasoning: `Matched by keyword pattern for ${categoryName}`
        };
      }
    }
  }
  
  // If no pattern matched, try partial matching with available categories
  for (const cat of categories) {
    const catNameLower = cat.name.toLowerCase();
    const words = textLower.split(/\s+/);
    if (words.some(word => word.includes(catNameLower) || catNameLower.includes(word))) {
      return {
        category: cat.name,
        confidence: 0.6,
        reasoning: `Matched category name in text`
      };
    }
  }
  
  return {
    category: 'Other',
    confidence: 0.3,
    reasoning: 'No matching category found'
  };
}

/**
 * Categorizes an expense using Groq's LLM model with fallback to manual parsing
 * @param {string} expenseDescription - Natural language description of the expense
 * @param {Array} availableCategories - Array of category objects with { id, name }
 * @param {string} expenseType - 'casual' or 'special' to influence categorization
 * @returns {Promise<{category: string, confidence: number, reasoning: string}>}
 */
export async function categorizeExpenseWithLLM(
  expenseDescription,
  availableCategories = [],
  expenseType = 'casual'
) {
  if (!expenseDescription || expenseDescription.trim().length === 0) {
    return { category: 'Other', confidence: 0, reasoning: 'Empty description' };
  }

  // Ensure we have categories from the database
  if (!availableCategories || availableCategories.length === 0) {
    console.warn('No categories provided, using manual fallback');
    return manualCategorizeByKeyword(expenseDescription, availableCategories);
  }

  if (!GROQ_API_KEY) {
    console.warn('Groq API key not found, using manual categorization');
    return manualCategorizeByKeyword(expenseDescription, availableCategories);
  }

  const categoryList = availableCategories.map(c => c.name).join(', ');

  const prompt = `You are an expense categorizer. Extract the item/service description from the text and categorize it.

Input text: "${expenseDescription}"
Expense type: ${expenseType}
Available categories: ${categoryList}

Instructions:
1. Ignore numbers, dates, and amounts - focus on WHAT the expense is for
2. Use the most relevant category from the list
3. Use "Other" only if nothing fits
4. Respond ONLY with valid JSON, nothing else

{"category":"CategoryName","confidence":0.9,"reasoning":"Why this category"}`;

  try {
    const response = await groqClient.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 150,
      top_p: 0.9,
    });

    const content = response.choices?.[0]?.message?.content || '{}';
    
    // Extract JSON from content (in case there's thinking tags or other text)
    // Look for the opening brace and extract everything from there
    const jsonStartIndex = content.indexOf('{');
    if (jsonStartIndex === -1) {
      console.warn('No JSON found in response:', content);
      return { category: 'Other', confidence: 0, reasoning: 'Could not parse LLM response' };
    }

    // Extract from { to the end, then parse incrementally
    let jsonStr = content.substring(jsonStartIndex);
    
    // Try to parse as-is first
    let result;
    try {
      result = JSON.parse(jsonStr);
    } catch (parseError) {
      // If parsing fails, try to close the JSON object if it's incomplete
      // Count braces to find the right closing brace
      let braceCount = 0;
      let closingIndex = -1;
      for (let i = 0; i < jsonStr.length; i++) {
        if (jsonStr[i] === '{') braceCount++;
        else if (jsonStr[i] === '}') {
          braceCount--;
          if (braceCount === 0) {
            closingIndex = i;
            break;
          }
        }
      }
      
      if (closingIndex > 0) {
        jsonStr = jsonStr.substring(0, closingIndex + 1);
        try {
          result = JSON.parse(jsonStr);
        } catch (e) {
          console.warn('Could not parse JSON even after truncation:', jsonStr, e);
          return { category: 'Other', confidence: 0, reasoning: 'Failed to parse LLM response' };
        }
      } else {
        console.warn('Could not find valid JSON:', content);
        return { category: 'Other', confidence: 0, reasoning: 'Invalid LLM response format' };
      }
    }
    
    // Validate the response structure
    if (result.category && typeof result.category === 'string') {
      return {
        category: result.category.trim(),
        confidence: result.confidence || 0.8,
        reasoning: result.reasoning || 'Categorized by LLM'
      };
    } else {
      console.warn('Invalid LLM response format, using manual fallback');
      return manualCategorizeByKeyword(expenseDescription, availableCategories);
    }
  } catch (error) {
    console.error('Error calling Groq API:', error);
    console.error('Error details:', {
      message: error.message,
      status: error.status,
      type: error.type,
      error: error.error
    });
    console.warn('LLM categorization failed, falling back to manual categorization');
    return manualCategorizeByKeyword(expenseDescription, availableCategories);
  }
}

/**
 * Batch categorize multiple expenses
 * @param {Array} expenses - Array of expense descriptions
 * @param {Array} availableCategories - Available category objects
 * @param {string} expenseType - 'casual' or 'special'
 * @returns {Promise<Array>} Array of categorization results
 */
export async function categorizeExpensesBatch(
  expenses = [],
  availableCategories = [],
  expenseType = 'casual'
) {
  if (expenses.length === 0) return [];
  
  // For batch, we'll categorize sequentially to avoid rate limits
  const results = [];
  for (const expense of expenses) {
    const result = await categorizeExpenseWithLLM(expense, availableCategories, expenseType);
    results.push(result);
    // Small delay between requests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return results;
}
