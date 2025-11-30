import React, { useCallback, useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { format, startOfMonth, endOfMonth, parseISO } from 'date-fns';

/**
 * Dashboard with:
 * - Top bar: budget, spent, balance (highlighted with icons and progress)
 * - Category cards showing totals for selected date range (one per row, with colors)
 * - Expand per-category expenses list with edit/delete
 * - Set budget for the month of the start date
 *
 * Notes:
 * - Assumes tables: expenses (category_id -> categories.id), categories, budgets
 * - Uses realtime + window 'expense-added' fallback (ExpenseInput dispatches event)
 */

function getMonthYearStr(date = new Date()) {
  return format(date, 'yyyy-MM');
}

function getMonthsInRange(start, end) {
  const months = [];
  let current = new Date(start.getFullYear(), start.getMonth(), 1);
  const endMonthStart = new Date(end.getFullYear(), end.getMonth(), 1);
  while (current <= endMonthStart) {
    months.push(format(current, 'yyyy-MM'));
    current.setMonth(current.getMonth() + 1);
  }
  return months;
}

export default function Dashboard({ user, trip = null, startDateStr: propStartDate, endDateStr: propEndDate, onDateChange }) {
  const [categories, setCategories] = useState([]); // {id, name}
  const [expenses, setExpenses] = useState([]); // all expenses for range
  const [grouped, setGrouped] = useState({}); // { categoryIdOrName: { total, rows: [] } }
  const [lendedTotal, setLendedTotal] = useState(0);
  const [borrowedTotal, setBorrowedTotal] = useState(0);
  const [selectedExpenses, setSelectedExpenses] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [budgetAmount, setBudgetAmount] = useState(0);
  const [totalBudget, setTotalBudget] = useState(0);
  const [budgetEditing, setBudgetEditing] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const channelRef = useRef(null);
  const startIsoRef = useRef();
  const endIsoRef = useRef();

  // Use props for dates if available (from App.jsx), otherwise use trip or default dates
  const startDateStr = propStartDate || (trip ? format(new Date(trip.start_date), 'yyyy-MM-dd') : format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const endDateStr = propEndDate || (trip ? format(new Date(trip.end_date), 'yyyy-MM-dd') : format(endOfMonth(new Date()), 'yyyy-MM-dd'));

  // UI state for expand lists & edit modal
  const [expandedCategory, setExpandedCategory] = useState(null);
  const [editModalRow, setEditModalRow] = useState(null);

  // Update ISO refs when date range changes (using UTC to match query)
  useEffect(() => {
    const [startY, startM, startD] = startDateStr.split('-').map(Number);
    const [endY, endM, endD] = endDateStr.split('-').map(Number);
    
    startIsoRef.current = new Date(Date.UTC(startY, startM - 1, startD, 0, 0, 0)).toISOString();
    endIsoRef.current = new Date(Date.UTC(endY, endM - 1, endD, 23, 59, 59, 999)).toISOString();
    
    console.log('Updated ISO refs:', { startIso: startIsoRef.current, endIso: endIsoRef.current });
  }, [startDateStr, endDateStr]);

  // Color palette for categories (cycled based on sorted order for consistency)
  const colorPalette = [
    '#ff6b6b', // Red
    '#4ecdc4', // Teal
    '#45b7d1', // Blue
    '#96ceb4', // Green
    '#feca57', // Yellow
    '#ff9ff3', // Pink
    '#54a0ff', // Light Blue
    '#5f27cd', // Purple
    '#00d2d3', // Cyan
    '#ff9f43'  // Orange
  ];

  const toggleSelect = useCallback((id) => {
    setSelectedExpenses(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  const deleteMultiple = useCallback(async () => {
    if (selectedExpenses.size === 0) return;
    if (!confirm(`Delete ${selectedExpenses.size} selected expenses?`)) return;
    const ids = Array.from(selectedExpenses);
    try {
      const { error } = await supabase
        .from('expenses')
        .delete()
        .in('id', ids);
      if (error) {
        console.error('delete multiple error', error);
        alert('Delete failed');
      } else {
        setExpenses(prev => prev.filter(r => !ids.includes(r.id)));
        setSelectedExpenses(new Set());
      }
    } catch (e) {
      console.error('unexpected delete multiple error', e);
      alert('Delete failed');
    }
  }, [selectedExpenses]);

  const selectAllInGroup = useCallback((groupId) => {
    const group = grouped[groupId];
    if (!group) return;
    
    setSelectedExpenses(prev => {
      const newSet = new Set(prev);
      const allSelected = group.rows.every(r => newSet.has(r.id));
      
      if (allSelected) {
        // Deselect all in this group
        group.rows.forEach(r => newSet.delete(r.id));
      } else {
        // Select all in this group
        group.rows.forEach(r => newSet.add(r.id));
      }
      return newSet;
    });
  }, [grouped]);

  // Helper: load categories
  useEffect(() => {
    let mounted = true;
    async function load() {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name')
        .order('name', { ascending: true });
      if (!mounted) return;
      if (error) {
        console.error('categories load error', error);
        setCategories([]);
      } else setCategories(data || []);
    }
    load();
    return () => { mounted = false; };
  }, []);

  // Load total budget for the range
  const loadTotalBudget = useCallback(async () => {
    if (!user?.id) return;

    // For casual expenses, get all months in the selected date range
    // For trips, get all months from trip start to trip end
    const months = trip
      ? getMonthsInRange(new Date(trip.start_date), new Date(trip.end_date))
      : getMonthsInRange(new Date(startDateStr), new Date(endDateStr));

    let query = supabase
      .from('budgets')
      .select('amount')
      .eq('user_id', user.id)
      .in('month_year', months);

    // THIS IS THE CORRECT WAY
    if (trip) {
      query = query.eq('trip_id', trip.id);           // Trip budget
    } else {
      query = query.is('trip_id', null);              // Casual budget – NULL
    }

    const { data, error } = await query;

    const total = (data || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    setTotalBudget(total);
  }, [user?.id, trip, startDateStr, endDateStr]);

  // Load expenses & budget for selected range
  const loadRange = useCallback(async () => {
    let mounted = true;

    setLoading(true);
    
    // Parse dates correctly: create UTC dates to avoid timezone shifting
    const [startY, startM, startD] = startDateStr.split('-').map(Number);
    const [endY, endM, endD] = endDateStr.split('-').map(Number);
    
    if (!startY || !startM || !startD || !endY || !endM || !endD) {
      console.error('Invalid date parsing:', { startDateStr, endDateStr });
      setLoading(false);
      return;
    }
    
    const startIso = new Date(Date.UTC(startY, startM - 1, startD, 0, 0, 0)).toISOString();
    const endIso = new Date(Date.UTC(endY, endM - 1, endD, 23, 59, 59, 999)).toISOString();
    
    const tripId = trip?.id;
    const isCasual = !tripId;
    console.log('Loading expenses for range:', { startDateStr, endDateStr, startIso, endIso, trip: tripId || 'casual (null)', user_id: user.id, isCasual });
    
    let query = supabase
      .from('expenses')
      .select(`
        id, amount, kind, note, original_text, date, created_at, category_id, trip_id
      `)
      .eq('user_id', user.id)
      .gte('date', startIso)
      .lte('date', endIso)
      .order('date', { ascending: false })
      .limit(1000);
    
    if (isCasual) {
      // For casual expenses, trip_id should be null
      query = query.is('trip_id', null);
      console.log('Querying casual expenses (trip_id = null)');
    } else {
      // For trip expenses
      query = query.eq('trip_id', tripId);
      console.log('Querying trip expenses (trip_id =', tripId, ')');
    }
    
    const { data, error } = await query;
    
    if (!mounted) return;
    if (error) {
      console.error('expenses load error', error);
      setExpenses([]);
    } else {
      console.log('✓ Loaded expenses:', data?.length || 0, 'records');
      if (data && data.length > 0) {
        console.log('First expense:', data[0]);
        // Debug: show trip_id values
        const trip_ids = [...new Set(data.map(d => d.trip_id))];
        console.log('Trip IDs in results:', trip_ids);
      }
      setExpenses(data || []);
    }
    setLoading(false);
  }, [user.id, startDateStr, endDateStr, trip]);

  // Load expenses and budget when date range or trip changes
  useEffect(() => {
    console.log('Load effect triggered with:', { startDateStr, endDateStr, trip: trip?.id || 'casual', userId: user.id });
    if (!user?.id) {
      console.log('User ID not available yet');
      return;
    }
    loadRange();
    loadTotalBudget();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDateStr, endDateStr, trip, user.id]);

  // Compute grouped, lended, borrowed from expenses
  useEffect(() => {
    // Build map: key = categoryId or 'uncategorized'
    const catMap = {};
    const idToName = {};
    categories.forEach(c => { idToName[c.id] = c.name; });

    let lendedTotal = 0;
    let borrowedTotal = 0;
    const catExpenses = [];

    for (const row of expenses) {
      if (row.kind === 'lended') {
        lendedTotal += Number(row.amount || 0);
      } else if (row.kind === 'borrowed') {
        borrowedTotal += Number(row.amount || 0);
      } else {
        catExpenses.push(row);
      }
    }

    setLendedTotal(lendedTotal);
    setBorrowedTotal(borrowedTotal);

    for (const row of catExpenses) {
      // transform category label
      const key = row.category_id || 'uncategorized';
      const name = row.category_id ? (idToName[row.category_id] || 'Unknown') : 'Other';
      if (!catMap[key]) catMap[key] = { id: key, name, total: 0, rows: [] };
      catMap[key].rows.push(row);
      catMap[key].total = Number(catMap[key].total || 0) + Number(row.amount || 0);
    }

    // ensure all categories exist in map (even with 0)
    categories.forEach(c => {
      if (!catMap[c.id]) catMap[c.id] = { id: c.id, name: c.name, total: 0, rows: [] };
    });

    // convert to object
    setGrouped(catMap);
  }, [expenses, categories]);

  // Optimistic add on event
  useEffect(() => {
    const handleAdded = (e) => {
      if (e.detail.user_id !== user.id) return;
      if (trip && e.detail.trip_id !== trip.id) return;
      if (!trip && e.detail.trip_id !== null) return;
      const expDate = new Date(e.detail.date);
      if (expDate < new Date(startIsoRef.current) || expDate > new Date(endIsoRef.current)) return;
      setExpenses(prev => {
        if (prev.some(r => r.id === e.detail.id)) return prev;
        return [e.detail, ...prev];
      });
    };
    window.addEventListener('expense-added', handleAdded);
    return () => window.removeEventListener('expense-added', handleAdded);
  }, [user.id, trip, startDateStr, endDateStr]);

  // Realtime subscription
  useEffect(() => {
    // subscribe to realtime changes for this user's expenses
    const channel = supabase.channel(`expenses-ch-${user.id}-${trip?.id || 'casual'}`);
    
    // Build filter: user_id must match, and trip_id must match view
    const tripFilter = trip ? `user_id=eq.${user.id},trip_id=eq.${trip.id}` : `user_id=eq.${user.id},trip_id=is.null`;
    
    channel
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'expenses', filter: tripFilter },
        (payload) => {
          if (payload?.new && startIsoRef.current && endIsoRef.current) {
            const newIso = payload.new.date;
            if (newIso >= startIsoRef.current && newIso <= endIsoRef.current) {
              // add into expenses list
              setExpenses(prev => {
                // avoid duplicate
                if (prev.some(r => r.id === payload.new.id)) return prev;
                return [payload.new, ...prev];
              });
            }
          }
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'expenses', filter: tripFilter },
        (payload) => {
          if (payload?.new && startIsoRef.current && endIsoRef.current) {
            setExpenses(prev => {
              const newRow = payload.new;
              const newIso = newRow.date;
              const isInRange = newIso >= startIsoRef.current && newIso <= endIsoRef.current;
              if (!isInRange) {
                return prev.filter(r => r.id !== newRow.id);
              }
              // Merge with existing row to preserve fields that might be missing in realtime payload
              const existingRow = prev.find(r => r.id === newRow.id);
              const mergedRow = existingRow ? { ...existingRow, ...newRow } : newRow;
              return prev.map(r => r.id === newRow.id ? mergedRow : r);
            });
          }
        })
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'expenses', filter: tripFilter },
        (payload) => {
          if (payload?.old) {
            setExpenses(prev => prev.filter(r => r.id !== payload.old.id));
          }
        })
      .subscribe();

    channelRef.current = channel;

    return () => {
      try {
        if (channelRef.current) {
          channelRef.current.unsubscribe();
          channelRef.current = null;
        }
      } catch {/* ignore */ }
    };
  }, [user.id, trip, startDateStr, endDateStr]);

  // Save budget function - replaces old setBudget
  const saveBudget = useCallback(async (amount) => {
    if (!user?.id || isNaN(amount) || amount < 0) return;

    // For casual expenses, get all months in the selected date range
    // For trips, get all months from trip start to trip end
    const months = trip
      ? getMonthsInRange(new Date(trip.start_date), new Date(trip.end_date))
      : getMonthsInRange(new Date(startDateStr), new Date(endDateStr));

    try {
      // Delete old budgets for same months + trip context
      let del = supabase
        .from('budgets')
        .delete()
        .eq('user_id', user.id)
        .in('month_year', months);

      if (trip) {
        del = del.eq('trip_id', trip.id);
      } else {
        del = del.is('trip_id', null);   // ← Correct for casual
      }
      await del;

      // Insert new budget rows
      const rows = months.map(m => ({
        user_id: user.id,
        trip_id: trip ? trip.id : null,   // null for casual
        month_year: m,
        amount: Number(amount)
      }));

      const { error } = await supabase.from('budgets').insert(rows);

      if (error) {
        alert('Failed to save budget');
        console.error(error);
      } else {
        setTotalBudget(amount * months.length);
        setBudgetEditing(false);
        setBudgetInput('');
      }
    } catch (e) {
      alert('Error saving budget');
    }
  }, [user?.id, trip, startDateStr, endDateStr]);

  const openEdit = useCallback((row) => {
    setEditModalRow({
      ...row,
      amount: Number(row.amount || 0),
      category_id: row.category_id || null,
      note: row.note || '',
      // Store original ISO date string so we can preserve the exact datetime when saving
      _originalDate: row.date,
      // Create datetime-local format by extracting date/time from ISO string
      date: row.date ? row.date.substring(0, 16) : new Date().toISOString().substring(0, 16)
    });
  }, []);

  const submitEdit = useCallback(async (updatedRow) => {
    const { id, _originalDate, ...updateData } = updatedRow;
    
    // Convert datetime-local string to ISO string
    // datetime-local format is "YYYY-MM-DDTHH:mm", convert to "YYYY-MM-DDTHH:mm:ss.000Z"
    if (updatedRow.date) {
      const dateTimeLocal = updatedRow.date; // e.g., "2025-11-30T14:30"
      // Parse the local datetime and add seconds and milliseconds
      const isoDate = dateTimeLocal + ':00.000Z'; // e.g., "2025-11-30T14:30:00.000Z"
      // This assumes the datetime-local is already in UTC (which it should be since we extracted from ISO)
      updateData.date = isoDate;
    }
    
    const { error } = await supabase
      .from('expenses')
      .update(updateData)
      .eq('id', id);
    if (error) {
      console.error('update error', error);
      alert('Update failed');
    } else {
      setEditModalRow(null);
      // realtime will apply update; also patch local list to feel instant
      // merge with original row to preserve all fields
      setExpenses(prev => prev.map(r => (r.id === id ? { ...r, ...updateData } : r)));
    }
  }, []);

  const deleteExpense = useCallback(async (row) => {
    if (!confirm('Delete this expense?')) return;
    const { error } = await supabase
      .from('expenses')
      .delete()
      .eq('id', row.id);
    if (error) {
      console.error('delete error', error);
      alert('Delete failed');
    } else {
      // realtime or window fallback will remove it; but to be safe remove locally
      setExpenses(prev => prev.filter(r => r.id !== row.id));
      if (selectedExpenses.has(row.id)) {
        toggleSelect(row.id);
      }
    }
  }, [selectedExpenses, toggleSelect]);

  const deleteCategory = useCallback(async (categoryId, categoryName) => {
    if (!confirm(`Delete category "${categoryName}"? All associated expenses will be recategorized to "Other".`)) return;
    
    try {
      // First, update all expenses with this category to "Other"
      const otherCategory = categories.find(c => c.name.toLowerCase() === 'other');
      const otherCategoryId = otherCategory ? otherCategory.id : null;
      
      if (otherCategoryId) {
        const { error: updateError } = await supabase
          .from('expenses')
          .update({ category_id: otherCategoryId })
          .eq('category_id', categoryId);
        
        if (updateError) {
          console.error('Error updating expenses:', updateError);
          alert('Failed to recategorize expenses');
          return;
        }
      }
      
      // Then delete the category
      const { error: deleteError } = await supabase
        .from('categories')
        .delete()
        .eq('id', categoryId);
      
      if (deleteError) {
        console.error('Error deleting category:', deleteError);
        alert('Failed to delete category');
      } else {
        // Update local categories state
        setCategories(prev => prev.filter(c => c.id !== categoryId));
        
        // Update expenses to reflect the recategorization
        setExpenses(prev => 
          prev.map(exp => 
            exp.category_id === categoryId 
              ? { ...exp, category_id: otherCategoryId } 
              : exp
          )
        );
      }
    } catch (err) {
      console.error('Unexpected error deleting category:', err);
      alert('Unexpected error while deleting category');
    }
  }, [categories]);

  // computed totals
  const totalSpent = Object.values(grouped).reduce((s, g) => s + Number(g.total || 0), 0);
  const monthYear = trip ? getMonthYearStr(new Date(trip.start_date)) : startDateStr.slice(0, 7);
  const balance = (Number(totalBudget || 0) - Number(totalSpent || 0));
  const progress = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;
  const startDisplay = format(new Date(startDateStr), 'dd MMM yyyy');
  const endDisplay = format(new Date(endDateStr), 'dd MMM yyyy');

  // handlers: expand category
  function toggleExpand(catId) {
    setExpandedCategory(prev => (prev === catId ? null : catId));
  }

  // helper to get category name for card header
  // eslint-disable-next-line no-unused-vars
  const catNameById = useCallback((id) => {
    if (!id) return 'Other';
    const c = categories.find(x => x.id === id);
    return c ? c.name : 'Other';
  }, [categories]);

  // Get color for a group (cycle through palette based on sorted category names for consistency)
  function getCategoryColor(group) {
    // Sort categories by name for consistent ordering
    const sortedGroups = Object.values(grouped).sort((a, b) => a.name.localeCompare(b.name));
    const index = sortedGroups.findIndex(g => g.id === group.id);
    return colorPalette[index % colorPalette.length];
  }

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>Loading dashboard...</div>;
  }

  const balanceTextColor = balance < 0 ? '#f44336' : '#2e7d32';
  const isMultipleSelected = selectedExpenses.size > 0;
  const buttonStyle = { fontSize: 12, padding: '4px 8px' };
  const disabledButtonStyle = { ...buttonStyle, opacity: 0.5, cursor: 'not-allowed' };

  return (
    <div style={{ backgroundColor: '#f8f9fa', minHeight: '100vh', padding: 'clamp(12px, 3vw, 20px)' }}>
      {/* Top bar - responsive grid */}
      <div className="card" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        gap: 'clamp(8px, 2vw, 12px)',
        alignItems: 'flex-start',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: 'white',
        padding: 'clamp(12px, 3vw, 20px)',
        borderRadius: '12px',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
      }}>
        {/* Header and Balance section */}
        <div style={{ gridColumn: 'span 1' }}>
          <h2 style={{ margin: 0, fontSize: 'clamp(1.3rem, 4vw, 1.8rem)' }}>Dashboard — {trip ? trip.name : `${startDisplay} to ${endDisplay}`}</h2>
          <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 'clamp(11px, 2vw, 13px)' }}>
            {trip ? `Trip expenses from ${startDisplay} to ${endDisplay}` : 'Showing expenses in custom date range'}
          </div>
          {/* Added Balance display below the showing dates */}
          <div style={{
            marginTop: 'clamp(8px, 2vw, 12px)',
            padding: 'clamp(8px, 2vw, 12px)',
            background: 'white',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            color: 'black',
            fontWeight: 'bold'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 'clamp(16px, 3vw, 24px)' }}>⚖️</span>
              <span style={{ fontSize: 'clamp(14px, 2.5vw, 16px)' }}>Balance</span>
            </div>
            <span style={{ fontSize: 'clamp(24px, 6vw, 32px)', color: balanceTextColor }}>₹{Number(balance || 0).toFixed(2)}</span>
          </div>
        </div>

        {/* Metrics and Budget section */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(8px, 2vw, 12px)', gridColumn: 'span 1' }}>
          {/* Budget */}
          <div style={{
            textAlign: 'center',
            padding: 'clamp(10px, 2vw, 16px)',
            background: 'white',
            borderRadius: '8px',
            flex: 1,
            position: 'relative'
          }}>
            <div style={{ fontSize: 'clamp(12px, 2vw, 14px)', color: 'black', marginBottom: 4 }}>💰 Budget (Period)</div>
            <div style={{ fontWeight: 'bold', fontSize: 'clamp(18px, 4vw, 24px)', color: '#1976d2' }}>₹{Number(totalBudget || 0).toFixed(2)}</div>
          </div>

          {/* Spent */}
          <div style={{
            textAlign: 'center',
            padding: 'clamp(10px, 2vw, 16px)',
            background: 'white',
            borderRadius: '8px'
          }}>
            <div style={{ fontSize: 'clamp(12px, 2vw, 14px)', color: 'black', marginBottom: 4 }}>💳 Spent</div>
            <div style={{ fontWeight: 'bold', fontSize: 'clamp(18px, 4vw, 24px)', color: '#f44336' }}>₹{Number(totalSpent || 0).toFixed(2)}</div>
          </div>

          {/* Set/Edit Budget button - Below Spent */}
          <div style={{ textAlign: 'center' }}>
            {budgetEditing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch' }}>
                <input
                  type="number"
                  value={budgetInput}
                  onChange={e => setBudgetInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const val = parseFloat(budgetInput);
                      if (!isNaN(val) && val >= 0) saveBudget(val);
                    }
                    if (e.key === 'Escape') {
                      setBudgetEditing(false);
                      setBudgetInput('');
                    }
                  }}
                  placeholder="0"
                  autoFocus
                  style={{ width: '100%', padding: 'clamp(6px, 1.5vw, 10px)', borderRadius: '4px', border: '2px solid #667eea', fontSize: 'clamp(12px, 2vw, 14px)' }}
                />
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button
                    onClick={() => {
                      const val = parseFloat(budgetInput);
                      if (!isNaN(val) && val >= 0) {
                        saveBudget(val);
                      }
                    }}
                    style={{ background: 'rgba(255, 255, 255, 0.7)', color: 'black', border: '1px solid rgba(0,0,0,0.1)', flex: 1, fontSize: 'clamp(12px, 2vw, 14px)', borderRadius: '4px', padding: 'clamp(6px, 1.5vw, 10px)', cursor: 'pointer', fontWeight: 'bold' }}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setBudgetEditing(false);
                      setBudgetInput('');
                    }}
                    style={{ background: 'rgba(255, 255, 255, 0.7)', color: 'black', border: '1px solid rgba(0,0,0,0.1)', flex: 1, fontSize: 'clamp(12px, 2vw, 14px)', borderRadius: '4px', padding: 'clamp(6px, 1.5vw, 10px)', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => {
                  setBudgetEditing(true);
                  setBudgetInput(totalBudget.toString());
                }}
                style={{ background: 'rgba(255,255,255,0.8)', color: 'black', border: '1px solid rgba(0,0,0,0.1)', fontSize: 'clamp(11px, 2vw, 14px)', fontWeight: 'bold', width: '100%', padding: 'clamp(6px, 1.5vw, 10px)', borderRadius: '4px', cursor: 'pointer' }}
              >
                {totalBudget > 0 ? 'Edit Budget' : 'Set Budget'}
              </button>
            )}
          </div>

          {/* Progress Bar - Below Budget button */}
          {totalBudget > 0 && (
            <div style={{
              background: 'rgba(255,255,255,0.1)',
              borderRadius: '6px',
              padding: 'clamp(8px, 2vw, 12px)',
              flex: 1
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 4,
                fontSize: 'clamp(11px, 1.8vw, 12px)',
                color: 'rgba(255,255,255,0.8)',
                marginBottom: 6
              }}>
                <span>Progress: {progress.toFixed(1)}%</span>
                <span style={{ color: progress > 100 ? '#f44336' : '#4caf50' }}>{progress > 100 ? 'Over Budget' : 'On Track'}</span>
              </div>
              <div style={{
                background: 'rgba(255,255,255,0.2)',
                borderRadius: '4px',
                height: '8px',
                overflow: 'hidden'
              }}>
                <div style={{
                  width: `${Math.min(progress, 100)}%`,
                  height: '100%',
                  background: progress > 100 ? '#f44336' : '#4caf50',
                  borderRadius: '4px',
                  transition: 'width 0.3s ease'
                }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Category cards - responsive grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(12px, 2vw, 16px)', marginTop: 'clamp(16px, 3vw, 20px)' }}>
        {Object.values(grouped)
          .filter(group => Number(group.total || 0) > 0)
          .map((group) => {
          const color = getCategoryColor(group);
          return (
            <div
              key={group.id}
              className="card"
              style={{
                width: '100%',
                background: 'white',
                borderRadius: '12px',
                boxShadow: '0 4px 6px rgba(0, 0, 0, 0.05)',
                overflow: 'hidden',
                borderLeft: `5px solid ${color}`
              }}
            >
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'clamp(8px, 2vw, 12px)',
                padding: 'clamp(12px, 2vw, 20px)',
                background: `${color}15`
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'clamp(12px, 2vw, 16px)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 'clamp(14px, 2vw, 16px)', color: color, fontWeight: 'bold', marginBottom: '4px' }}>{group.name}</div>
                    <div style={{ fontSize: 'clamp(20px, 5vw, 24px)', fontWeight: 'bold', color: color }}>₹{Number(group.total || 0).toFixed(2)}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 'clamp(6px, 1.5vw, 8px)', alignItems: 'center', flexShrink: 0 }}>
                    <button
                      className="btn-ghost"
                      onClick={() => toggleExpand(group.id)}
                      style={{ color: color, fontSize: 'clamp(12px, 2vw, 14px)', padding: 'clamp(4px, 1vw, 8px) clamp(6px, 1.5vw, 10px)', whiteSpace: 'nowrap' }}
                    >
                      {expandedCategory === group.id ? 'Hide' : `View (${group.rows.length})`}
                    </button>
                    {/* Delete category button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteCategory(group.id, group.name);
                      }}
                      style={{
                        background: 'rgba(244,67,54,0.15)',
                        color: '#e74c3c',
                        border: '1px solid #e74c3c',
                        borderRadius: '6px',
                        padding: 'clamp(4px, 1vw, 6px) clamp(6px, 1.5vw, 10px)',
                        cursor: 'pointer',
                        fontSize: 'clamp(14px, 2vw, 16px)',
                        transition: 'all 0.2s ease',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth: '32px',
                        flexShrink: 0
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(244,67,54,0.8)'; e.currentTarget.style.color = 'white'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(244,67,54,0.15)'; e.currentTarget.style.color = '#e74c3c'; }}
                      title="Delete category"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>

              {expandedCategory === group.id && (
                <div style={{ padding: 'clamp(12px, 2vw, 20px)' }}>
                  <div style={{
                    padding: 'clamp(8px, 1.5vw, 10px) 0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderBottom: '1px solid #eee',
                    marginBottom: 10,
                    flexWrap: 'wrap',
                    gap: 8
                  }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => selectAllInGroup(group.id)}
                        style={{
                          color: '#667eea',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: 'clamp(11px, 1.8vw, 12px)',
                          fontWeight: 'bold'
                        }}
                      >
                        {group.rows.every(r => selectedExpenses.has(r.id)) ? 'Deselect All' : 'Select All'}
                      </button>
                      {selectedExpenses.size > 0 && <span style={{ color: '#666', fontSize: 'clamp(11px, 1.8vw, 12px)' }}>({selectedExpenses.size} selected)</span>}
                    </div>
                    {selectedExpenses.size > 0 && (
                      <button
                        onClick={deleteMultiple}
                        style={{
                          color: '#e74c3c',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: 'clamp(12px, 2vw, 14px)'
                        }}
                      >
                        Delete Selected
                      </button>
                    )}
                  </div>
                  {group.rows.length === 0 && <div style={{ color: '#666', padding: 'clamp(8px, 1.5vw, 10px) 0', fontSize: 'clamp(12px, 2vw, 14px)' }}>No expenses</div>}
                  <ul className="recent-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {group.rows.map(r => (
                      <li
                        key={r.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          gap: 'clamp(6px, 1.5vw, 8px)',
                          padding: 'clamp(8px, 1.5vw, 12px)',
                          background: 'rgba(0,0,0,0.02)',
                          borderRadius: '8px',
                          marginBottom: '8px',
                          flexWrap: 'wrap'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedExpenses.has(r.id)}
                          onChange={() => toggleSelect(r.id)}
                          style={{ marginRight: 8, marginTop: 2, cursor: 'pointer', width: '16px', height: '16px' }}
                        />
                        <div style={{ flex: 1, minWidth: '150px' }}>
                          <div style={{ fontWeight: 'bold', marginBottom: '4px', fontSize: 'clamp(13px, 2.2vw, 14px)' }}>
                            <strong>₹{Number(r.amount).toFixed(2)}</strong> — {r.note || r.original_text || r.kind}
                          </div>
                          <div style={{ fontSize: 'clamp(11px, 1.8vw, 12px)', color: '#666' }}>{format(parseISO(r.date), 'MMM dd, yyyy HH:mm')}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 'clamp(4px, 1vw, 6px)', flexWrap: 'wrap' }}>
                          <button
                            className="btn-ghost"
                            onClick={(e) => { e.stopPropagation(); openEdit(r); }}
                            disabled={isMultipleSelected}
                            style={{...isMultipleSelected ? disabledButtonStyle : buttonStyle, fontSize: 'clamp(11px, 1.8vw, 12px)', padding: 'clamp(4px, 1vw, 6px) clamp(6px, 1.5vw, 8px)' }}
                          >
                            Edit
                          </button>
                          <button
                            className="btn-ghost"
                            onClick={(e) => { e.stopPropagation(); deleteExpense(r); }}
                            disabled={isMultipleSelected}
                            style={{...isMultipleSelected ? disabledButtonStyle : { ...buttonStyle, color: '#e74c3c' }, fontSize: 'clamp(11px, 1.8vw, 12px)', padding: 'clamp(4px, 1vw, 6px) clamp(6px, 1.5vw, 8px)' }}
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Lended and Borrowed cards */}
      {(lendedTotal > 0 || borrowedTotal > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(12px, 2vw, 16px)', marginTop: 'clamp(16px, 3vw, 20px)' }}>
          {lendedTotal > 0 && (
            <div className="card" style={{ 
              width: '100%', 
              background: 'white', 
              borderRadius: '12px', 
              boxShadow: '0 4px 6px rgba(0, 0, 0, 0.05)', 
              overflow: 'hidden',
              borderLeft: `5px solid #2e7d32`
            }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                padding: 'clamp(12px, 2vw, 20px)', 
                background: 'rgba(46, 125, 50, 0.05)' 
              }}>
                <div>
                  <div style={{ fontSize: 'clamp(14px, 2vw, 16px)', color: '#2e7d32', fontWeight: 'bold', marginBottom: '4px' }}>Lended</div>
                  <div style={{ fontSize: 'clamp(20px, 5vw, 24px)', fontWeight: 'bold', color: '#2e7d32' }}>₹{Number(lendedTotal).toFixed(2)}</div>
                </div>
              </div>
            </div>
          )}
          {borrowedTotal > 0 && (
            <div className="card" style={{ 
              width: '100%', 
              background: 'white', 
              borderRadius: '12px', 
              boxShadow: '0 4px 6px rgba(0, 0, 0, 0.05)', 
              overflow: 'hidden',
              borderLeft: `5px solid #f44336`
            }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                padding: 'clamp(12px, 2vw, 20px)', 
                background: 'rgba(244, 67, 54, 0.05)' 
              }}>
                <div>
                  <div style={{ fontSize: 'clamp(14px, 2vw, 16px)', color: '#f44336', fontWeight: 'bold', marginBottom: '4px' }}>Borrowed</div>
                  <div style={{ fontSize: 'clamp(20px, 5vw, 24px)', fontWeight: 'bold', color: '#f44336' }}>₹{Number(borrowedTotal).toFixed(2)}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Edit modal (simple inline overlay) - Responsive */}
      {editModalRow && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: '12px'
        }}>
          <div style={{ 
            width: '100%',
            maxWidth: 520, 
            background: '#fff', 
            padding: 'clamp(16px, 3vw, 24px)', 
            borderRadius: 12, 
            boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
            maxHeight: '90vh',
            overflowY: 'auto'
          }}>
            <h3 style={{ margin: '0 0 16px 0', color: '#333', fontSize: 'clamp(1.1rem, 3vw, 1.3rem)' }}>Edit expense</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ fontWeight: 'bold', color: '#333', fontSize: 'clamp(13px, 2vw, 14px)' }}>Amount</label>
              <input 
                type="number" 
                value={editModalRow.amount} 
                onChange={e => setEditModalRow(prev => ({ ...prev, amount: e.target.value }))} 
                style={{ padding: '10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }} 
              />

              <label style={{ fontWeight: 'bold', color: '#333', fontSize: 'clamp(13px, 2vw, 14px)' }}>Category</label>
              <select 
                value={editModalRow.category_id || ''} 
                onChange={e => setEditModalRow(prev => ({ ...prev, category_id: e.target.value || null }))}
                style={{ padding: '10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
              >
                <option value=''>Other</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>

              <label style={{ fontWeight: 'bold', color: '#333', fontSize: 'clamp(13px, 2vw, 14px)' }}>Note</label>
              <input 
                value={editModalRow.note || ''} 
                onChange={e => setEditModalRow(prev => ({ ...prev, note: e.target.value }))} 
                style={{ padding: '10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }} 
              />

              <label style={{ fontWeight: 'bold', color: '#333', fontSize: 'clamp(13px, 2vw, 14px)' }}>Date & time</label>
              <input 
                type="datetime-local" 
                value={editModalRow.date} 
                onChange={e => setEditModalRow(prev => ({ ...prev, date: e.target.value }))} 
                style={{ padding: '10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }} 
              />

              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
                <button className="btn-ghost" onClick={() => setEditModalRow(null)} style={{ padding: '8px 16px', fontSize: 'clamp(12px, 2vw, 14px)', flex: 1, minWidth: '80px' }}>Cancel</button>
                <button className="btn" onClick={() => submitEdit(editModalRow)} style={{ padding: '8px 16px', background: '#667eea', color: 'white', fontSize: 'clamp(12px, 2vw, 14px)', flex: 1, minWidth: '80px' }}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* small footer spacing */}
      <div style={{ height: 20 }} />
    </div>
  );
}