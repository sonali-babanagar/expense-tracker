// TripsTab.jsx (Updated to preserve original trip card CSS/structure and re-add trip status logic)
import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { format } from 'date-fns';
import ExpenseInput from './ExpenseInput';


// Added onTripStatusChange prop
export default function TripsTab({ user, onTripSelect, startDateStr, endDateStr, onTripStatusChange }) {
  const [trips, setTrips] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newTrip, setNewTrip] = useState({ name: '', start: '', end: '' });
  const [message, setMessage] = useState('');
  const [expandedTripId, setExpandedTripId] = useState(null);
  const [tripExpenses, setTripExpenses] = useState({});
  const [showAddExpense, setShowAddExpense] = useState({});
  const [selectedExpenses, setSelectedExpenses] = useState(new Set());
  const [expandedCategories, setExpandedCategories] = useState({});
  const [categories, setCategories] = useState({});
  const [budgetEditingTripId, setBudgetEditingTripId] = useState(null);
  const [tripBudgetAmounts, setTripBudgetAmounts] = useState({});
  const [budgetInputValues, setBudgetInputValues] = useState({});
  const [categoryToDelete, setCategoryToDelete] = useState(null);

  const loadTripsWithSummary = useCallback(async () => {
    // Load categories
    const { data: categoriesData } = await supabase
      .from('categories')
      .select('id, name');
    
    const catMap = {};
    if (categoriesData) {
      categoriesData.forEach(cat => {
        catMap[cat.id] = cat.name;
      });
    }
    setCategories(catMap);

    const { data: tripsData } = await supabase
      .from('trips')
      .select('*')
      .eq('user_id', user.id)
      .order('start_date', { ascending: false });

    if (!tripsData || tripsData.length === 0) {
      setTrips([]);
      // Re-added trip status change logic
      if (onTripStatusChange) { 
        onTripStatusChange(0); 
      }
      return;
    }

    // Parse dates for filtering
    const [startY, startM, startD] = (startDateStr || '').split('-').map(Number);
    const [endY, endM, endD] = (endDateStr || '').split('-').map(Number);
    
    let startIso = null;
    let endIso = null;
    
    if (startY && startM && startD && endY && endM && endD) {
      startIso = new Date(Date.UTC(startY, startM - 1, startD, 0, 0, 0)).toISOString();
      endIso = new Date(Date.UTC(endY, endM - 1, endD, 23, 59, 59, 999)).toISOString();
    }

    // Load trip expenses with date filtering
    let query = supabase
      .from('expenses')
      .select('id, trip_id, amount, kind, category_id, note, created_at, date')
      .eq('user_id', user.id)
      .not('trip_id', 'is', null)
      .order('created_at', { ascending: false });

    // Apply date range filter if dates are valid
    if (startIso && endIso) {
      query = query.gte('date', startIso).lte('date', endIso);
    }

    const { data: expensesData } = await query;

    // Group expenses per trip
    const expensesByTrip = {};
    const expenseSums = {};
    if (expensesData) {
      expensesData.forEach(exp => {
        if (!expensesByTrip[exp.trip_id]) {
          expensesByTrip[exp.trip_id] = [];
          expenseSums[exp.trip_id] = 0;
        }
        expensesByTrip[exp.trip_id].push(exp);
        if (exp.kind === 'expense') {
          expenseSums[exp.trip_id] += Number(exp.amount || 0);
        }
      });
    }
    setTripExpenses(expensesByTrip);

    // Load all trip budgets
    const { data: budgetsData } = await supabase
      .from('budgets')
      .select('trip_id, amount')
      .eq('user_id', user.id)
      .not('trip_id', 'is', null);

    const budgetSums = {};
    const budgetAmountsByTrip = {};
    if (budgetsData) {
      budgetsData.forEach(bud => {
        if (!budgetSums[bud.trip_id]) budgetSums[bud.trip_id] = 0;
        budgetSums[bud.trip_id] += Number(bud.amount || 0);
        budgetAmountsByTrip[bud.trip_id] = Number(bud.amount || 0);
      });
    }
    setTripBudgetAmounts(budgetAmountsByTrip);

    // Filter trips that overlap with the selected date range
    let filteredTrips = tripsData;
    if (startIso && endIso) {
      filteredTrips = tripsData.filter(trip => {
        // A trip overlaps with the date range if:
        // trip.start_date <= filterRange.end AND trip.end_date >= filterRange.start
        const tripStart = new Date(trip.start_date).toISOString();
        const tripEnd = new Date(trip.end_date).toISOString();
        return tripStart <= endIso && tripEnd >= startIso;
      });
    }

    // Combine
    const tripsWithSummary = filteredTrips.map(trip => {
      // Use expenses that fall within the current date filter for the summary
      const spent = expenseSums[trip.id] || 0; 
      
      // Note: Budgets are loaded for all time, which is generally correct for a trip budget
      const budget = budgetSums[trip.id] || 0;
      const balance = budget - spent;
      const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
      return {
        ...trip,
        spent,
        budget,
        balance,
        spentPct: pct
      };
    });

    setTrips(tripsWithSummary);
    // Re-added trip status change logic
    if (onTripStatusChange) { 
        onTripStatusChange(tripsWithSummary.length); 
    }
  }, [user.id, startDateStr, endDateStr, onTripStatusChange]); // onTripStatusChange added to dependencies


  useEffect(() => {
    loadTripsWithSummary();

    // Listen for expense-added event to refresh trip data
    const handleExpenseAdded = (event) => {
      console.log('Expense added event received:', event.detail);
      loadTripsWithSummary();
    };

    window.addEventListener('expense-added', handleExpenseAdded);

    return () => {
      window.removeEventListener('expense-added', handleExpenseAdded);
    };
    // Dependencies now correctly include all external values used by loadTripsWithSummary's closure
  }, [user.id, startDateStr, endDateStr, loadTripsWithSummary]); 

  async function createTrip() {
    setMessage('');
    if (!newTrip.name || !newTrip.start || !newTrip.end) return setMessage('Please fill all fields');
    if (new Date(newTrip.start) >= new Date(newTrip.end)) return setMessage('End date must be after start date');
    const { data, error } = await supabase
      .from('trips')
      .insert({
        user_id: user.id,
        name: newTrip.name,
        start_date: newTrip.start,
        end_date: newTrip.end
      })
      .select()
      .single();
    if (error) {
      setMessage(error.message);
    } else {
      setShowCreate(false);
      setNewTrip({ name: '', start: '', end: '' });

      // Re-added optimistic trip status change logic
      if (onTripStatusChange) {
        onTripStatusChange(trips.length + 1); 
      }

      await loadTripsWithSummary();
      onTripSelect(data);
    }
  }

  async function deleteTrip(tripId) {
    if (!confirm('Are you sure you want to delete this trip? This action cannot be undone.')) return;
    
    try {
      // Delete all expenses associated with the trip
      const { error: expError } = await supabase
        .from('expenses')
        .delete()
        .eq('trip_id', tripId);
      
      if (expError) {
        console.error('Error deleting expenses', expError);
        setMessage('Failed to delete trip expenses');
        return;
      }

      // Delete all budgets associated with the trip
      const { error: budError } = await supabase
        .from('budgets')
        .delete()
        .eq('trip_id', tripId);
      
      if (budError) {
        console.error('Error deleting budgets', budError);
        setMessage('Failed to delete trip budgets');
        return;
      }

      // Delete the trip itself
      const { error: tripError } = await supabase
        .from('trips')
        .delete()
        .eq('id', tripId);
      
      if (tripError) {
        console.error('Error deleting trip', tripError);
        setMessage('Failed to delete trip');
      } else {
        setMessage('Trip deleted successfully');
        setExpandedTripId(null);
        setSelectedExpenses(new Set());

        // Re-added optimistic trip status change logic
        if (onTripStatusChange) {
            onTripStatusChange(trips.length > 0 ? trips.length - 1 : 0); 
        }

        await loadTripsWithSummary();
        setTimeout(() => setMessage(''), 2000);
      }
    } catch (err) {
      console.error('Unexpected error deleting trip', err);
      setMessage('Unexpected error while deleting trip');
    }
  }

  // ---------- PRESENTATION HELPERS ----------

  // Original containerStyle with gap: 16
  const containerStyle = { display: 'flex', flexDirection: 'column', gap: 16 };

  function formatMoney(n) {
    return `₹${Number(n || 0).toFixed(2)}`;
  }

  function getGradientForIndex(i) {
    // subtle set of gradients — will cycle with index
    const grads = [
      'linear-gradient(135deg,#667eea 0%,#764ba2 100%)',
      'linear-gradient(135deg,#ff9a9e 0%,#fad0c4 100%)',
      'linear-gradient(135deg,#f6d365 0%,#fda085 100%)',
      'linear-gradient(135deg,#a18cd1 0%,#fbc2eb 100%)',
      'linear-gradient(135deg,#89f7fe 0%,#66a6ff 100%)',
      'linear-gradient(135deg,#e0c3fc 0%,#8ec5fc 100%)'
    ];
    return grads[i % grads.length];
  }

  function toggleExpandTrip(tripId) {
    setExpandedTripId(expandedTripId === tripId ? null : tripId);
  }

  function toggleAddExpenseForm(tripId) {
    setShowAddExpense(prev => ({
      ...prev,
      [tripId]: !prev[tripId]
    }));
  }

  function toggleSelectExpense(expenseId) {
    setSelectedExpenses(prev => {
      const newSet = new Set(prev);
      if (newSet.has(expenseId)) {
        newSet.delete(expenseId);
      } else {
        newSet.add(expenseId);
      }
      return newSet;
    });
  }

  function selectAllInCategory(tripId, categoryKey, groupRows) {
    setSelectedExpenses(prev => {
      const newSet = new Set(prev);
      const allSelected = groupRows.every(r => newSet.has(r.id));
      
      if (allSelected) {
        // Deselect all in this category
        groupRows.forEach(r => newSet.delete(r.id));
      } else {
        // Select all in this category
        groupRows.forEach(r => newSet.add(r.id));
      }
      return newSet;
    });
  }

  const isMultipleSelected = selectedExpenses.size > 0;
  const buttonStyle = { fontSize: 12, padding: '4px 8px' };
  const disabledButtonStyle = { ...buttonStyle, opacity: 0.5, cursor: 'not-allowed' };

  async function deleteSelectedExpenses() {
    if (selectedExpenses.size === 0) return;
    if (!confirm(`Delete ${selectedExpenses.size} selected expenses?`)) return;
    
    const ids = Array.from(selectedExpenses);
    try {
      const { error } = await supabase
        .from('expenses')
        .delete()
        .in('id', ids);
      
      if (error) {
        console.error('Delete error', error);
      } else {
        setSelectedExpenses(new Set());
        await loadTripsWithSummary();
      }
    } catch (err) {
      console.error('Delete failed', err);
    }
  }

  function toggleExpandCategory(tripId, categoryKey) {
    setExpandedCategories(prev => {
      const key = `${tripId}-${categoryKey}`;
      const newState = { ...prev };
      if (newState[key]) {
        delete newState[key];
      } else {
        newState[key] = true;
      }
      return newState;
    });
  }

  function getCategoryColor(categoryId) {
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
    const allCategories = Object.keys(categories).sort();
    const index = allCategories.indexOf(categoryId);
    return colorPalette[(index >= 0 ? index : 0) % colorPalette.length];
  }

  async function deleteCategory(tripId, categoryId, categoryName) {
    if (!confirm(`Delete category "${categoryName}"? This will remove all expenses in this category from the trip.`)) return;
    
    try {
      // Delete all expenses with this category for this trip
      const { error } = await supabase
        .from('expenses')
        .delete()
        .eq('trip_id', tripId)
        .eq('category_id', categoryId);
      
      if (error) {
        console.error('Error deleting category expenses', error);
        alert('Failed to delete category expenses');
      } else {
        await loadTripsWithSummary();
      }
    } catch (err) {
      console.error('Unexpected error deleting category', err);
      alert('Unexpected error while deleting category');
    }
  }

  async function setTripBudget(tripId, budgetAmount) {
    if (!budgetAmount || Number(budgetAmount) <= 0) {
      alert('Please enter a valid budget amount');
      return;
    }

    try {
      // Find the trip to get its date for month_year
      const trip = trips.find(t => t.id === tripId);
      if (!trip) {
        alert('Trip not found');
        return;
      }

      // Generate month_year from trip start date (format: YYYY-MM)
      const tripDate = new Date(trip.start_date);
      const monthYear = `${tripDate.getFullYear()}-${String(tripDate.getMonth() + 1).padStart(2, '0')}`;

      // Check if budget already exists for this trip
      const { data: existing } = await supabase
        .from('budgets')
        .select('id')
        .eq('user_id', user.id)
        .eq('trip_id', tripId)
        .limit(1);

      if (existing && existing.length > 0) {
        // Update existing budget
        const { error } = await supabase
          .from('budgets')
          .update({ amount: Number(budgetAmount) })
          .eq('id', existing[0].id);
        if (error) throw error;
      } else {
        // Create new budget with month_year
        const { error } = await supabase
          .from('budgets')
          .insert([{ 
            user_id: user.id, 
            trip_id: tripId, 
            month_year: monthYear,
            amount: Number(budgetAmount)
          }]);
        if (error) throw error;
      }

      // Update state and reload
      setTripBudgetAmounts(prev => ({ ...prev, [tripId]: Number(budgetAmount) }));
      setBudgetInputValues(prev => ({ ...prev, [tripId]: '' }));
      setBudgetEditingTripId(null);
      await loadTripsWithSummary();
    } catch (err) {
      console.error('Error setting budget', err);
      alert('Failed to set budget');
    }
  }

  function groupExpensesByCategory(expenses) {
    const grouped = {};
    expenses.forEach(exp => {
      const catId = exp.category_id || 'uncategorized';
      const catName = exp.category_id ? (categories[exp.category_id] || 'Unknown') : 'Other';
      const key = `${catId}-${catName}`;
      
      if (!grouped[key]) {
        grouped[key] = {
          id: catId,
          name: catName,
          total: 0,
          rows: []
        };
      }
      grouped[key].rows.push(exp);
      grouped[key].total += Number(exp.amount || 0);
    });
    
    return Object.values(grouped).sort((a, b) => b.total - a.total);
  }

  // ---------- RENDER (Original CSS/Structure Restored) ----------
  if (showCreate) {
    const dateInputStyle = {
      padding: '10px',
      border: '1px solid #ddd',
      borderRadius: '6px',
      fontSize: '14px',
      color: '#333',
      backgroundColor: '#fff',
      WebkitTextFillColor: '#333',
      caretColor: '#333',
      fontWeight: '500',
      width: '100%',
      boxSizing: 'border-box'
    };

    return (
      <div className="card" style={{ marginBottom: 'clamp(12px, 2vw, 20px)' }}>
        <h3 style={{ fontSize: 'clamp(1.1rem, 3vw, 1.3rem)' }}>Create New Trip</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(8px, 2vw, 12px)' }}>
          <input
            placeholder="Trip name (e.g., Goa Vacation)"
            value={newTrip.name}
            onChange={e => setNewTrip(prev => ({ ...prev, name: e.target.value }))}
            style={dateInputStyle}
          />
          <input
            type="date"
            value={newTrip.start}
            onChange={e => setNewTrip(prev => ({ ...prev, start: e.target.value }))}
            style={dateInputStyle}
          />
          <input
            type="date"
            value={newTrip.end}
            onChange={e => setNewTrip(prev => ({ ...prev, end: e.target.value }))}
            style={dateInputStyle}
          />
          <div style={{ display: 'flex', gap: 'clamp(8px, 2vw, 12px)', flexWrap: 'wrap' }}>
            <button className="btn" onClick={createTrip} style={{ flex: 1, minWidth: '100px', fontSize: 'clamp(12px, 2vw, 14px)' }}>Create</button>
            <button className="btn-ghost" onClick={() => { setShowCreate(false); setMessage(''); }} style={{ flex: 1, minWidth: '100px', fontSize: 'clamp(12px, 2vw, 14px)' }}>Cancel</button>
          </div>
          {message && <p className="message" style={{ color: '#e74c3c', fontSize: 'clamp(12px, 2vw, 14px)' }}>{message}</p>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'clamp(12px, 2vw, 20px)', gap: '12px', flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: 'clamp(1.1rem, 3vw, 1.3rem)' }}>Special Expenditures</h3>
        <button className="btn" onClick={() => setShowCreate(true)} style={{ fontSize: 'clamp(12px, 2vw, 14px)', padding: 'clamp(6px, 1.5vw, 10px) clamp(10px, 2vw, 16px)' }}>New</button>
      </div>

      {trips.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 'clamp(24px, 3vw, 40px)', fontSize: 'clamp(13px, 2vw, 14px)' }}>
          <p>No trips yet. Create one to start tracking special expenses.</p>
        </div>
      ) : (
        <div style={containerStyle}>
          {trips.map((trip, idx) => {
            const isExpanded = expandedTripId === trip.id;
            const gradient = getGradientForIndex(idx);
            const expenses = tripExpenses[trip.id] || [];
            
            return (
              // Outer div used for spacing (gap: 16)
              <div key={trip.id} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {/* Trip Card Header - ALL ORIGINAL STYLES RESTORED */}
                <div
                  className="card trip-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleExpandTrip(trip.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') toggleExpandTrip(trip.id); }}
                  style={{
                    border: isExpanded ? '2px solid rgba(50,79,246,0.9)' : '1px solid rgba(0,0,0,0.06)',
                    cursor: 'pointer',
                    transition: 'transform 0.18s ease, box-shadow 0.18s ease, border 0.12s ease',
                    boxShadow: isExpanded ? '0 12px 30px rgba(50,79,246,0.12)' : '0 6px 18px rgba(10,10,10,0.06)',
                    overflow: 'hidden',
                    borderRadius: isExpanded ? '12px 12px 0px 0px' : 12,
                    minHeight: 'auto',
                    display: 'flex',
                    flexDirection: 'column'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
                >
                  {/* Header gradient */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 'clamp(8px, 2vw, 12px)',
                    padding: 'clamp(12px, 2vw, 16px)',
                    background: gradient,
                    color: 'white',
                    position: 'relative',
                    flexWrap: 'wrap'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(8px, 2vw, 12px)', flex: 1, minWidth: 0 }}>
                      <div style={{
                        width: 'clamp(40px, 10vw, 56px)', height: 'clamp(40px, 10vw, 56px)', borderRadius: 12, display: 'flex',
                        flexShrink: 0,
                        alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.12)', fontSize: 'clamp(16px, 3vw, 20px)', fontWeight: '700'
                      }}>
                        ✈️
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                          <h3 style={{ margin: 0, fontSize: 'clamp(14px, 2.5vw, 16px)', fontWeight: 700 }}>{trip.name}</h3>
                        </div>
                        <div style={{ fontSize: 'clamp(11px, 1.8vw, 12px)', opacity: 0.95 }}>
                          {format(new Date(trip.start_date), 'MMM dd, yyyy')} — {format(new Date(trip.end_date), 'MMM dd, yyyy')}
                        </div>
                      </div>
                    </div>

                    {/* Right side controls */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(8px, 2vw, 12px)', flexShrink: 0 }}>
                      {/* Expand/Collapse chevron */}
                      <div style={{
                        fontSize: 'clamp(14px, 2.5vw, 20px)',
                        transition: 'transform 0.2s ease',
                        transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        ▼
                      </div>

                      {/* Delete button (Kept in header) */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteTrip(trip.id);
                        }}
                        style={{
                          background: 'rgba(255,255,255,0.25)',
                          color: 'white',
                          border: '1px solid rgba(255,255,255,0.4)',
                          borderRadius: '6px',
                          padding: 'clamp(4px, 1vw, 6px) clamp(6px, 1.5vw, 10px)',
                          cursor: 'pointer',
                          fontSize: 'clamp(14px, 2.5vw, 16px)',
                          transition: 'all 0.2s ease',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          minWidth: '32px'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(244,67,54,0.8)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.6)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.25)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)'; }}
                        title="Delete trip"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {/* Body */}
                  <div style={{ padding: 'clamp(10px, 2vw, 12px) clamp(12px, 2vw, 16px)', display: 'flex', flexDirection: 'column', gap: 'clamp(8px, 2vw, 12px)', alignItems: 'stretch', background: '#fff' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 'clamp(8px, 2vw, 12px)', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                        <div>
                          <div style={{ fontSize: 'clamp(11px, 1.8vw, 13px)', color: '#666' }}>Budget</div>
                          <div style={{ fontWeight: '700', fontSize: 'clamp(13px, 2.2vw, 15px)' }}>{formatMoney(trip.budget)}</div>
                        </div>

                        <div style={{ width: 1, height: 30, background: '#ddd' }} />

                        <div>
                          <div style={{ fontSize: 'clamp(11px, 1.8vw, 13px)', color: '#666' }}>Spent</div>
                          <div style={{ fontWeight: '700', fontSize: 'clamp(13px, 2.2vw, 15px)', color: '#c62828' }}>{formatMoney(trip.spent)}</div>
                        </div>

                        <div style={{ width: 1, height: 30, background: '#ddd' }} />

                        <div>
                          <div style={{ fontSize: 'clamp(11px, 1.8vw, 13px)', color: '#666' }}>Balance</div>
                          <div style={{ fontWeight: '700', fontSize: 'clamp(13px, 2.2vw, 15px)', color: trip.balance >= 0 ? '#2e7d32' : '#f44336' }}>
                            {formatMoney(trip.balance)}
                          </div>
                        </div>
                      </div>

                      {/* progress bar */}
                      <div style={{ height: 10, background: '#f1f3f7', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
                        <div style={{
                          width: `${trip.spentPct}%`,
                          height: '100%',
                          background: trip.spentPct > 100 ? '#f44336' : '#4caf50',
                          transition: 'width 0.35s ease'
                        }} />
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, fontSize: 'clamp(11px, 1.8vw, 12px)', color: '#777', flexWrap: 'wrap', gap: 4 }}>
                        <div>{trip.spentPct.toFixed(0)}% used</div>
                        <div>{trip.budget > 0 ? `${Math.max(0, (trip.budget - trip.spent)).toFixed(2)} left` : 'No budget set'}</div>
                      </div>

                      {/* Set/Edit Budget Button - Similar to Dashboard */}
                      <div style={{ textAlign: 'center' }}>
                        {budgetEditingTripId === trip.id ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch' }}>
                            <input 
                              type="number"
                              value={budgetInputValues[trip.id] || ''} 
                              onChange={e => setBudgetInputValues(prev => ({ ...prev, [trip.id]: e.target.value }))} 
                              placeholder="amount" 
                              style={{ width: '100%', padding: 'clamp(6px, 1.5vw, 10px)', borderRadius: '4px', border: '1px solid rgba(0,0,0,0.1)', fontSize: 'clamp(12px, 2vw, 14px)' }} 
                            />
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <button 
                                className="btn" 
                                onClick={() => setTripBudget(trip.id, budgetInputValues[trip.id])} 
                                style={{ background: 'rgba(179, 132, 228, 0.6)', color: 'black', border: '1px solid rgba(0,0,0,0.1)', flex: 1, fontSize: 'clamp(12px, 2vw, 14px)', borderRadius: '4px', padding: 'clamp(6px, 1.5vw, 10px)', cursor: 'pointer' }}
                              >
                                Save
                              </button>
                              <button 
                                className="btn-ghost" 
                                onClick={() => { setBudgetEditingTripId(null); setBudgetInputValues(prev => ({ ...prev, [trip.id]: String(trip.budget || '') })); }} 
                                style={{ background: 'rgba(179, 132, 228, 0.6)', color: 'black', border: '1px solid rgba(0,0,0,0.1)', flex: 1, fontSize: 'clamp(12px, 2vw, 14px)', borderRadius: '4px', padding: 'clamp(6px, 1.5vw, 10px)', cursor: 'pointer' }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button 
                            className="btn" 
                            onClick={() => { setBudgetEditingTripId(trip.id); setBudgetInputValues(prev => ({ ...prev, [trip.id]: String(trip.budget || '') })); }} 
                            style={{ background: 'rgba(161, 101, 225, 0.77)', color: 'black', border: '1px solid rgba(0,0,0,0.1)', fontSize: 'clamp(11px, 2vw, 14px)', fontWeight: 'bold', width: '100%', padding: 'clamp(6px, 1.5vw, 10px)', borderRadius: '4px', cursor: 'pointer' }}
                          >
                            Set / Edit Budget
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Row with Expand on left and Healthy on right */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'clamp(8px, 2vw, 12px)' }}>
                      <div style={{
                        padding: 'clamp(4px, 1vw, 6px) clamp(8px, 1.5vw, 10px)',
                        borderRadius: 8,
                        background: isExpanded ? 'rgba(247, 245, 246, 1)' : 'rgba(0,0,0,0.04)',
                        fontSize: 'clamp(11px, 1.8vw, 13px)',
                        fontWeight: 700
                      }}>
                        {isExpanded ? 'Expanded' : 'Expand'}
                      </div>

                      <div style={{
                        padding: 'clamp(4px, 1vw, 6px) clamp(8px, 1.5vw, 10px)',
                        borderRadius: 999,
                        background: trip.balance >= 0 ? 'rgba(46,125,50,0.12)' : 'rgba(244,67,54,0.12)',
                        color: trip.balance >= 0 ? '#2e7d32' : '#f44336',
                        fontWeight: 700,
                        fontSize: 'clamp(11px, 1.8vw, 13px)'
                      }}>
                        {trip.balance >= 0 ? 'Healthy' : 'Over Budget'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expandable Details Section */}
                {isExpanded && (
                  <div style={{
                    borderLeft: '1px solid rgba(0,0,0,0.06)',
                    borderRight: '1px solid rgba(0,0,0,0.06)',
                    borderBottom: '1px solid rgba(0,0,0,0.06)',
                    borderRadius: '0px 0px 12px 12px',
                    padding: '16px',
                    background: '#fafbfc',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 16
                  }}>
                    
                    {/* Add Expense Section */}
                    <div style={{
                      padding: '16px',
                      background: '#fff',
                      borderRadius: 8,
                      border: '1px solid rgba(0,0,0,0.04)'
                    }}>
                      {!showAddExpense[trip.id] ? (
                        <button
                          className="btn"
                          onClick={() => toggleAddExpenseForm(trip.id)}
                          style={{
                            width: '100%',
                            padding: '10px 16px',
                            fontWeight: 600,
                            fontSize: 14,
                            cursor: 'pointer'
                          }}
                        >
                          + Add Expense
                        </button>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Add Expense</h4>
                          <ExpenseInput 
                            user={user} 
                            trip_id={trip.id} 
                            onSuccess={() => { // Re-added onSuccess handler
                              toggleAddExpenseForm(trip.id);
                              loadTripsWithSummary();
                            }}
                          />
                          {/* Re-added manual Close button since it was in the user's provided code */}
                          <button
                            className="btn-ghost"
                            onClick={() => {
                              toggleAddExpenseForm(trip.id);
                              loadTripsWithSummary(); // Refresh data on close
                            }}
                            style={{
                              padding: '8px 16px',
                              fontSize: 13,
                              cursor: 'pointer'
                            }}
                          >
                            Close
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Summary Details */}
                    {/* <div style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 16,
                      padding: '16px',
                      background: '#fff',
                      borderRadius: 8,
                      border: '1px solid rgba(0,0,0,0.04)'
                    }}>
                      <div>
                        <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Total Budget</div>
                        <div style={{ fontSize: 18, fontWeight: '700', color: '#333' }}>{formatMoney(trip.budget)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Total Spent</div>
                        <div style={{ fontSize: 18, fontWeight: '700', color: '#c62828' }}>{formatMoney(trip.spent)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Balance</div>
                        <div style={{
                          fontSize: 18,
                          fontWeight: '700',
                          color: trip.balance >= 0 ? '#2e7d32' : '#f44336'
                        }}>
                          {formatMoney(trip.balance)}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Usage</div>
                        <div style={{ fontSize: 18, fontWeight: '700', color: '#333' }}>{trip.spentPct.toFixed(1)}%</div>
                      </div>
                    </div>
                     */}
                    {/* Expenses List by Category - Dashboard Style */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      {expenses.length === 0 ? (
                        <div style={{ padding: '20px', background: '#fff', borderRadius: 8, textAlign: 'center', color: '#999', fontSize: 13 }}>
                          No expenses yet
                        </div>
                      ) : (
                        groupExpensesByCategory(expenses).map(group => {
                          const color = getCategoryColor(group.id);
                          const isCatExpanded = expandedCategories[`${trip.id}-${group.id}`];
                          return (
                            <div
                              key={group.id}
                              style={{
                                width: '100%',
                                background: 'white',
                                borderRadius: '12px',
                                boxShadow: '0 4px 6px rgba(0, 0, 0, 0.05)',
                                overflow: 'hidden',
                                borderLeft: `5px solid ${color}`
                              }}
                            >
                              {/* Category Header */}
                              <div
                                onClick={() => toggleExpandCategory(trip.id, group.id)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => { if (e.key === 'Enter') toggleExpandCategory(trip.id, group.id); }}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  padding: '20px',
                                  background: `${color}15`,
                                  cursor: 'pointer',
                                  transition: 'all 0.2s ease'
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = `${color}25`}
                                onMouseLeave={e => e.currentTarget.style.background = `${color}15`}
                              >
                                <div>
                                  <div style={{ fontSize: 14, color: color, fontWeight: 'bold', marginBottom: '4px' }}>
                                    {group.name}
                                  </div>
                                  <div style={{ fontSize: 22, fontWeight: 'bold', color: color }}>
                                    ₹{Number(group.total || 0).toFixed(2)}
                                  </div>
                                </div>
                                <div style={{ display: 'flex', gap: 'clamp(6px, 1.5vw, 8px)', alignItems: 'center', flexShrink: 0 }}>
                                  <button
                                    className="btn-ghost"
                                    onClick={(e) => { e.stopPropagation(); toggleExpandCategory(trip.id, group.id); }}
                                    style={{ color: color, fontSize: 13, fontWeight: 600 }}
                                  >
                                    {isCatExpanded ? 'Hide' : `View (${group.rows.length})`}
                                  </button>
                                  {/* Delete category button */}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      deleteCategory(trip.id, group.id, group.name);
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

                              {/* Expanded Expenses */}
                              {isCatExpanded && (
                                <div style={{ padding: '0 20px 20px' }}>
                                  <div style={{
                                    padding: '10px 0',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    borderBottom: '1px solid #eee',
                                    marginBottom: 10,
                                    marginTop: 10
                                  }}>
                                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                      <button
                                        onClick={() => selectAllInCategory(trip.id, group.id, group.rows)}
                                        style={{
                                          color: '#667eea',
                                          background: 'none',
                                          border: 'none',
                                          cursor: 'pointer',
                                          fontSize: 12,
                                          fontWeight: 'bold'
                                        }}
                                      >
                                        {group.rows.every(r => selectedExpenses.has(r.id)) ? 'Deselect All' : 'Select All'}
                                      </button>
                                      {selectedExpenses.size > 0 && <span style={{ color: '#666', fontSize: 12 }}>({selectedExpenses.size} selected)</span>}
                                    </div>

                                    {/* Delete Selected Button */}
                                    <button
                                        onClick={deleteSelectedExpenses}
                                        disabled={!isMultipleSelected}
                                        style={isMultipleSelected 
                                          ? { ...buttonStyle, background: '#e74c3c', color: 'white', border: 'none' } 
                                          : disabledButtonStyle
                                        }
                                      >
                                        Delete Selected
                                      </button>

                                  </div>
                                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                                    {group.rows.map(exp => (
                                      <li
                                        key={exp.id}
                                        style={{
                                          display: 'flex',
                                          justifyContent: 'space-between',
                                          alignItems: 'center',
                                          padding: '12px 0',
                                          borderBottom: '1px solid #f0f0f0',
                                          background: selectedExpenses.has(exp.id) ? `${color}10` : 'transparent',
                                          transition: 'background 0.2s ease',
                                        }}
                                      >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                                          <input
                                            type="checkbox"
                                            checked={selectedExpenses.has(exp.id)}
                                            onChange={() => toggleSelectExpense(exp.id)}
                                            style={{ cursor: 'pointer' }}
                                          />
                                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <div style={{ fontSize: 14, fontWeight: '500', color: '#333' }}>
                                              {exp.note || 'No note'}
                                            </div>
                                            <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                                              {format(new Date(exp.date), 'MMM dd, yyyy @ h:mm a')}
                                            </div>
                                          </div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                          <span style={{ fontSize: 16, fontWeight: '700', color: exp.kind === 'income' ? '#2e7d32' : '#c62828' }}>
                                            {formatMoney(exp.amount)}
                                          </span>
                                          <button
                                            className="btn-ghost"
                                            onClick={() => {/* Edit functionality - placeholder */}}
                                            disabled={isMultipleSelected}
                                            style={isMultipleSelected ? disabledButtonStyle : buttonStyle}
                                          >
                                            Edit
                                          </button>
                                          <button
                                            className="btn-ghost"
                                            onClick={() => {/* Delete functionality - placeholder */}}
                                            disabled={isMultipleSelected}
                                            style={isMultipleSelected ? { ...disabledButtonStyle, color: '#e74c3c' } : { ...buttonStyle, color: '#e74c3c' }}
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
                        })
                      )}
                    </div>

                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}