import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { categorizeExpenseWithLLM } from '../lib/groqCategorizer';

/**
 * ExpenseInput: sends parsed expense to DB and dispatches a window event
 * so Dashboard can update immediately (optimistic fallback).
 */
export default function ExpenseInput({ user, trip_id = null, onSuccess = () => {}, expenseType = 'casual' }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState([]); // { id, name }
  const [message, setMessage] = useState('');
  const [categorizationInProgress, setCategorizationInProgress] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function loadCategories() {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name')
        .order('name', { ascending: true });

      if (!mounted) return;
      if (error) {
        console.error('Error loading categories', error);
        setCategories([]);
      } else {
        setCategories(data || []);
      }
    }
    loadCategories();
    return () => { mounted = false; };
  }, []);

  function findCategoryIdByName(name) {
    if (!name) return null;
    const target = name.trim().toLowerCase();
    const found = categories.find(c => c.name && c.name.toLowerCase() === target);
    if (found) return found.id;
    const partial = categories.find(c => c.name && c.name.toLowerCase().includes(target));
    if (partial) return partial.id;
    const other = categories.find(c => c.name && c.name.toLowerCase() === 'other');
    return other ? other.id : null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setMessage('');
    if (!text || !text.trim()) return;
    setLoading(true);

    // Use LLM to parse amount, category, and expense details
    setMessage('Processing with AI...');
    
    try {
      // Create a comprehensive parsing prompt
      const categoryList = categories.map(c => c.name).join(', ') || 'Food, Transport, Shopping, Bills, Other';
      const parsingPrompt = `Parse this expense and extract details. Respond ONLY with valid JSON.

Input: "${text.trim()}"
Expense type: ${expenseType}
Available categories: ${categoryList}

Extract: amount (number), category (from list), and kind (expense/borrowed/lended).
{"amount":100,"category":"Food","kind":"expense","note":"description"}`;

      const parseResponse = await categorizeExpenseWithLLM(
        text.trim(),
        categories,
        expenseType
      );

      // For now, use the LLM response and extract amount from text
      const amountMatch = text.match(/(\d+(?:\.\d{2})?)/);
      if (!amountMatch) {
        setMessage('Please include an amount in your expense (e.g., "100 facewash")');
        setLoading(false);
        return;
      }

      const amount = Number(amountMatch[1]);
      if (Number.isNaN(amount) || amount <= 0) {
        setMessage('Amount must be a positive number.');
        setLoading(false);
        return;
      }

      const categoryName = parseResponse.category || 'Other';
      const category_id = findCategoryIdByName(categoryName);
      
      // Determine kind (expense, borrowed, lended)
      let kind = 'expense';
      const textLower = text.toLowerCase();
      if (textLower.includes('borr')) kind = 'borrowed';
      else if (textLower.includes('len') || textLower.includes('lend')) kind = 'lended';

      console.log('LLM Parsing & Categorization:', {
        input: text.trim(),
        amount,
        category: categoryName,
        kind,
        confidence: parseResponse.confidence,
        reasoning: parseResponse.reasoning
      });

      const insertRow = {
        user_id: user.id,
        kind,
        amount,
        category_id,
        note: categoryName !== 'Other' ? categoryName : null,
        original_text: text,
        metadata: { 
          parsed_from: 'llm',
          llm_categorized: true,
          expense_type: expenseType,
          confidence: parseResponse.confidence
        },
        date: new Date().toISOString(),
        ...(trip_id && { trip_id })
      };

      // Return inserted row so we can optimistically update UI.
      // Use uppercase name to avoid "unused var" lint rules if you don't use it elsewhere.
      const { data: INSERTED_ROWS, error } = await supabase
        .from('expenses')
        .insert([insertRow])
        .select()
        .single();

      if (error) {
        console.error('Insert error', error);
        setMessage('Failed to add expense (db error).');
      } else {
        // success — clear input and dispatch event for Dashboard fallback
        setText('');
        setMessage('Added ✓');

        // dispatch event with inserted row details (so Dashboard can optimistically add)
        try {
          window.dispatchEvent(new CustomEvent('expense-added', { detail: INSERTED_ROWS }));
        } catch (evErr) {
          // fallback: console log
          console.warn('Could not dispatch expense-added event', evErr);
        }
        
        // Auto-close after 1.5 seconds to show the success message then clear it
        setTimeout(() => {
          setMessage(''); // Clear the message
          if (onSuccess) onSuccess();
        }, 1500); 
      }
    } catch (err) {
      console.error('Error processing expense:', err);
      setMessage('Error: ' + (err.message || 'Failed to process expense'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: 'white',
      borderRadius: '12px',
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
      overflow: 'hidden',
      marginBottom: 'clamp(12px, 2vw, 20px)'
    }}>
      <div style={{ padding: 'clamp(14px, 3vw, 20px)' }}>
        <h3 style={{ margin: '0 0 clamp(10px, 2vw, 16px) 0', fontSize: 'clamp(1.3rem, 4vw, 1.8rem)', fontWeight: 'bold' }}>Add New Expense</h3>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(8px, 2vw, 12px)' }}>
          <input
            placeholder='e.g., "I spent 100 rupees on chips" or "100 Food"'
            value={text}
            onChange={e => setText(e.target.value)}
            style={{
              width: '100%',
              padding: 'clamp(10px, 2vw, 14px) clamp(10px, 2vw, 16px)',
              borderRadius: '8px',
              border: 'none',
              fontSize: '16px',
              background: 'rgba(255, 255, 255, 0.9)',
              color: '#333',
              outline: 'none',
              boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.05)'
            }}
            disabled={loading}
          />
          <div style={{ display: 'flex', gap: 'clamp(8px, 2vw, 12px)', alignItems: 'center', flexWrap: 'wrap' }}>
            <button 
              className="btn" 
              type="submit" 
              disabled={loading}
              style={{
                flex: 1,
                minWidth: '100px',
                padding: 'clamp(10px, 2vw, 12px)',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.2)',
                color: 'white',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                fontSize: 'clamp(13px, 2.2vw, 16px)',
                fontWeight: 'bold',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
                transition: 'all 0.2s ease'
              }}
            >
              {loading ? 'Adding...' : 'Add Expense'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => { setText(''); setMessage(''); }}
              disabled={loading}
              style={{
                padding: 'clamp(10px, 2vw, 12px) clamp(12px, 2vw, 16px)',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.1)',
                color: 'white',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                fontSize: 'clamp(13px, 2.2vw, 16px)',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
                transition: 'all 0.2s ease'
              }}
            >
              Clear
            </button>
          </div>
          {message && (
            <div style={{
              padding: 'clamp(8px, 1.5vw, 10px) clamp(10px, 2vw, 14px)',
              borderRadius: '6px',
              textAlign: 'center',
              fontWeight: '500',
              background: message.includes('✓') ? 'rgba(76, 175, 80, 0.2)' : 'rgba(244, 67, 54, 0.2)',
              color: message.includes('✓') ? '#4caf50' : '#f44336',
              border: `1px solid ${message.includes('✓') ? 'rgba(76, 175, 80, 0.3)' : 'rgba(244, 67, 54, 0.3)'}`,
              animation: 'fadeIn 0.3s ease-in',
              fontSize: 'clamp(12px, 2vw, 14px)'
            }}>
              {message}
            </div>
          )}
        </form>

        <div style={{ marginTop: 'clamp(10px, 2vw, 16px)', paddingTop: 'clamp(10px, 2vw, 16px)', borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
          <small style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: 'clamp(11px, 1.8vw, 12px)' }}>
            Categories: {categories.length > 0 ? categories.map(c => c.name).join(', ') : 'loading...'}
          </small>
        </div>
      </div>
    </div>
  );
}