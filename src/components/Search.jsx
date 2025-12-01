import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { format, parseISO } from 'date-fns';

export default function Search({ user, startDateStr, endDateStr }) {
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState([]);
  const [expenseTypes] = useState(['expense', 'borrowed', 'lended']);
  const [expenseContexts] = useState(['casual', 'special']);

  // Filter states
  const [selectedCategories, setSelectedCategories] = useState(new Set());
  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedTypes, setSelectedTypes] = useState(new Set());
  const [selectedContexts, setSelectedContexts] = useState(new Set());

  // Load categories
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

  // Search expenses
  const performSearch = useCallback(async () => {
    if (!user?.id || !startDateStr || !endDateStr) return;

    setLoading(true);
    try {
      // Parse dates
      const [startY, startM, startD] = startDateStr.split('-').map(Number);
      const [endY, endM, endD] = endDateStr.split('-').map(Number);

      const startIso = new Date(Date.UTC(startY, startM - 1, startD, 0, 0, 0)).toISOString();
      const endIso = new Date(Date.UTC(endY, endM - 1, endD, 23, 59, 59, 999)).toISOString();

      // Build base query - don't filter by trip_id, apply it in client-side filtering
      let query = supabase
        .from('expenses')
        .select('id, amount, kind, note, original_text, date, category_id, trip_id, created_at')
        .eq('user_id', user.id)
        .gte('date', startIso)
        .lte('date', endIso)
        .order('date', { ascending: false });

      // Apply filters
      const filters = [];

      // Category filter
      if (selectedCategories.size > 0) {
        const catArray = Array.from(selectedCategories);
        filters.push({ type: 'category', values: catArray });
      }

      // Type filter
      if (selectedTypes.size > 0) {
        const typeArray = Array.from(selectedTypes);
        filters.push({ type: 'kind', values: typeArray });
      }

      const { data, error } = await query;

      if (error) {
        console.error('Search error:', error);
        setSearchResults([]);
      } else {
        let results = data || [];

        // Apply context filter (Casual/Special)
        if (selectedContexts.size > 0) {
          results = results.filter(r => {
            const isCasual = !r.trip_id;
            if (selectedContexts.has('casual') && isCasual) return true;
            if (selectedContexts.has('special') && !isCasual) return true;
            return false;
          });
        }

        // Apply category filter
        if (selectedCategories.size > 0) {
          results = results.filter(r => selectedCategories.has(r.category_id || 'uncategorized'));
        }

        // Apply type filter
        if (selectedTypes.size > 0) {
          results = results.filter(r => selectedTypes.has(r.kind));
        }

        // Apply keyword filter
        if (searchKeyword.trim()) {
          const keyword = searchKeyword.toLowerCase().trim();
          results = results.filter(r => {
            const note = (r.note || '').toLowerCase();
            const original = (r.original_text || '').toLowerCase();
            return note.includes(keyword) || original.includes(keyword);
          });
        }

        setSearchResults(results);
      }
    } catch (err) {
      console.error('Search error:', err);
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id, startDateStr, endDateStr, selectedCategories, selectedTypes, selectedContexts, searchKeyword]);

  // Toggle category selection
  const toggleCategory = (categoryId) => {
    setSelectedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId);
      } else {
        newSet.add(categoryId);
      }
      return newSet;
    });
  };

  // Toggle type selection
  const toggleType = (type) => {
    setSelectedTypes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(type)) {
        newSet.delete(type);
      } else {
        newSet.add(type);
      }
      return newSet;
    });
  };

  // Clear all filters
  const clearFilters = () => {
    setSelectedCategories(new Set());
    setSelectedTypes(new Set());
    setSelectedContexts(new Set());
    setSearchKeyword('');
  };

  // Toggle context selection (Casual/Special)
  const toggleContext = (context) => {
    setSelectedContexts(prev => {
      const newSet = new Set(prev);
      if (newSet.has(context)) {
        newSet.delete(context);
      } else {
        newSet.add(context);
      }
      return newSet;
    });
  };

  // Helper to get category name
  const getCategoryName = (categoryId) => {
    if (!categoryId || categoryId === 'uncategorized') return 'Other';
    const cat = categories.find(c => c.id === categoryId);
    return cat ? cat.name : 'Unknown';
  };

  // Helper to format expense kind
  const formatKind = (kind) => {
    return kind.charAt(0).toUpperCase() + kind.slice(1);
  };

  return (
    <div style={{ padding: 'clamp(12px, 2vw, 20px)' }}>
      <h2 style={{ marginTop: 0, fontSize: 'clamp(1.2rem, 3vw, 1.4rem)' }}>Search Expenses</h2>

      {/* Filters Section */}
      <div style={{
        background: '#f5f5f5',
        padding: 'clamp(12px, 2vw, 16px)',
        borderRadius: '8px',
        marginBottom: '20px',
        border: '1px solid #ddd'
      }}>
        {/* Keyword Search */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '6px', fontSize: 'clamp(12px, 1.8vw, 14px)' }}>
            Search by Keyword
          </label>
          <input
            type="text"
            value={searchKeyword}
            onChange={e => setSearchKeyword(e.target.value)}
            placeholder="Search in comments or keywords..."
            style={{
              width: '100%',
              padding: '8px 12px',
              border: '1px solid #ccc',
              borderRadius: '6px',
              fontSize: '14px',
              boxSizing: 'border-box'
            }}
          />
        </div>

        {/* Category Filter */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px', fontSize: 'clamp(12px, 1.8vw, 14px)' }}>
            Filter by Category
          </label>
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px'
          }}>
            <button
              onClick={() => toggleCategory('uncategorized')}
              style={{
                padding: '6px 12px',
                border: selectedCategories.has('uncategorized') ? '2px solid #667eea' : '1px solid #ccc',
                background: selectedCategories.has('uncategorized') ? 'rgba(102, 126, 234, 0.1)' : 'white',
                borderRadius: '20px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: selectedCategories.has('uncategorized') ? 'bold' : 'normal',
                transition: 'all 0.2s ease',
                color: '#333'
              }}
            >
              Other
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => toggleCategory(cat.id)}
                style={{
                  padding: '6px 12px',
                  border: selectedCategories.has(cat.id) ? '2px solid #667eea' : '1px solid #ccc',
                  background: selectedCategories.has(cat.id) ? 'rgba(102, 126, 234, 0.1)' : 'white',
                  borderRadius: '20px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: selectedCategories.has(cat.id) ? 'bold' : 'normal',
                  transition: 'all 0.2s ease',
                  color: '#333'
                }}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        {/* Expense Context Filter (Casual/Special) */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px', fontSize: 'clamp(12px, 1.8vw, 14px)' }}>
            Filter by Expense Type
          </label>
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px'
          }}>
            {expenseContexts.map(context => (
              <button
                key={context}
                onClick={() => toggleContext(context)}
                style={{
                  padding: '6px 12px',
                  border: selectedContexts.has(context) ? '2px solid #667eea' : '1px solid #ccc',
                  background: selectedContexts.has(context) ? 'rgba(102, 126, 234, 0.1)' : 'white',
                  borderRadius: '20px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: selectedContexts.has(context) ? 'bold' : 'normal',
                  transition: 'all 0.2s ease',
                  color: '#333'
                }}
              >
                {context.charAt(0).toUpperCase() + context.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{
          display: 'flex',
          gap: '8px',
          flexWrap: 'wrap'
        }}>
          <button
            onClick={performSearch}
            disabled={loading}
            style={{
              padding: '8px 16px',
              background: '#667eea',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '12px',
              fontWeight: 'bold',
              opacity: loading ? 0.6 : 1
            }}
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
          <button
            onClick={clearFilters}
            style={{
              padding: '8px 16px',
              background: '#f0f0f0',
              color: '#333',
              border: '1px solid #ddd',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 'bold'
            }}
          >
            Clear Filters
          </button>
        </div>
      </div>

      {/* Results Section */}
      <div>
        <h3 style={{ fontSize: 'clamp(1rem, 2.5vw, 1.2rem)', marginBottom: '12px' }}>
          Results {searchResults.length > 0 && `(${searchResults.length})`}
        </h3>

        {searchResults.length === 0 && !loading && (
          <div style={{
            background: '#f9f9f9',
            padding: '20px',
            borderRadius: '8px',
            textAlign: 'center',
            color: '#999',
            fontSize: '14px'
          }}>
            No expenses found matching your criteria.
          </div>
        )}

        {searchResults.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {searchResults.map(expense => (
              <div
                key={expense.id}
                style={{
                  background: 'white',
                  border: '1px solid #eee',
                  borderRadius: '8px',
                  padding: 'clamp(8px, 1.5vw, 12px)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: '12px',
                  flexWrap: 'wrap'
                }}
              >
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '4px', fontSize: 'clamp(12px, 2vw, 14px)' }}>
                    {expense.note || expense.original_text || 'No description'}
                  </div>
                  <div style={{ fontSize: 'clamp(11px, 1.8vw, 12px)', color: '#666', marginBottom: '4px' }}>
                    {format(parseISO(expense.date), 'MMM dd, yyyy @ h:mm a')}
                  </div>
                  <div style={{ fontSize: 'clamp(11px, 1.8vw, 12px)', color: '#999' }}>
                    <span style={{ marginRight: '12px' }}>
                      {expense.trip_id ? 'Special' : 'Casual'}
                    </span>
                    <span style={{ marginRight: '12px' }}>
                      Category: <strong>{getCategoryName(expense.category_id)}</strong>
                    </span>
                    <span>
                      Type: <strong>{formatKind(expense.kind)}</strong>
                    </span>
                  </div>
                </div>
                <div style={{
                  fontSize: 'clamp(13px, 2.2vw, 16px)',
                  fontWeight: 'bold',
                  color: expense.kind === 'lended' ? '#2e7d32' : expense.kind === 'borrowed' ? '#d32f2f' : '#333',
                  minWidth: '100px',
                  textAlign: 'right'
                }}>
                  {expense.kind === 'lended' && '+ '}
                  {expense.kind === 'borrowed' && '- '}
                  ₹{Number(expense.amount).toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
