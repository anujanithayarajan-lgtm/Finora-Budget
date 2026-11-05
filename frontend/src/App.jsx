import { useEffect, useMemo, useRef, useState } from 'react';
import { Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Tooltip,
  Legend
} from 'chart.js';
import { jsPDF } from 'jspdf';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/+$/, '');
const LOGO_URL = '/finora-logo.png';

const loadLogoDataUrl = async () => {
  const response = await fetch(LOGO_URL);
  if (!response.ok) {
    throw new Error('The Finora logo could not be loaded for the PDF.');
  }

  const image = new Image();
  const imageUrl = URL.createObjectURL(await response.blob());

  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('The Finora logo image is invalid.'));
      image.src = imageUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not prepare the Finora logo for the PDF.');
    }

    context.drawImage(image, 0, 0);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
};

const currencyOptions = [
  { code: 'LKR', name: 'Sri Lankan Rupee' },
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'AED', name: 'UAE Dirham' }
];

const currencyLocales = {
  LKR: 'en-LK',
  USD: 'en-US',
  EUR: 'de-DE',
  GBP: 'en-GB',
  INR: 'en-IN',
  AUD: 'en-AU',
  CAD: 'en-CA',
  JPY: 'ja-JP',
  AED: 'en-AE'
};

const getTransactionPeriodFromLocation = () => {
  const params = new URLSearchParams(window.location.search);
  const month = Number(params.get('month'));
  const year = Number(params.get('year'));

  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 1900) {
    return null;
  }

  return { month: String(month), year: String(year) };
};

const getReportYearFromLocation = () => {
  const match = window.location.pathname.match(/^\/reports\/years\/(\d{4})$/);
  return match ? match[1] : null;
};

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const defaultForm = {
  type: 'income',
  category: '',
  amount: '',
  note: '',
  date: new Date().toISOString().split('T')[0]
};

const defaultAuth = {
  name: '',
  email: '',
  password: ''
};

const getAuthToken = () => localStorage.getItem('finora_token');

const saveToken = (token) => localStorage.setItem('finora_token', token);

const removeToken = () => localStorage.removeItem('finora_token');

const buildHeaders = (token) => ({
  'Content-Type': 'application/json',
  Authorization: token ? `Bearer ${token}` : undefined
});

function TransactionTable({ items, onEdit, onDelete, formatCurrency }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Category</th>
            <th>Date</th>
            <th>Note</th>
            <th>Amount</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {items.length ? items.map((item) => (
            <tr key={item.id}>
              <td><span className={`badge ${item.type}`}>{item.type}</span></td>
              <td>{item.category}</td>
              <td>{new Date(`${item.date}T00:00:00`).toLocaleDateString('en-GB')}</td>
              <td>{item.note || '—'}</td>
              <td className={item.type === 'income' ? 'value income-text' : 'value expense-text'}>
                {item.type === 'income' ? '+' : '-'} {formatCurrency(Number(item.amount || 0))}
              </td>
              <td>
                <div className="action-buttons">
                  <button type="button" className="tiny-btn edit" onClick={() => onEdit(item)}>Edit</button>
                  <button type="button" className="tiny-btn delete" onClick={() => onDelete(item.id)}>Delete</button>
                </div>
              </td>
            </tr>
          )) : (
            <tr>
              <td colSpan="6" className="empty-state">No transactions for this period.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function App() {
  const [token, setToken] = useState(getAuthToken());
  const [user, setUser] = useState(null);
  const [showAllTransactions, setShowAllTransactions] = useState(() => window.location.pathname === '/transactions');
  const [showYearReport, setShowYearReport] = useState(() => Boolean(getReportYearFromLocation()));
  const [selectedReportYear, setSelectedReportYear] = useState(() => getReportYearFromLocation());
  const [transactionPeriod, setTransactionPeriod] = useState(getTransactionPeriodFromLocation);
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState(defaultAuth);
  const [selectedMonth, setSelectedMonth] = useState(() => getTransactionPeriodFromLocation()?.month || String(new Date().getMonth() + 1));
  const [selectedYear, setSelectedYear] = useState(() => getTransactionPeriodFromLocation()?.year || String(new Date().getFullYear()));
  const [summary, setSummary] = useState({ summary: { income: 0, expense: 0, balance: 0 }, monthlyBreakdown: [], categoryBreakdown: [] });
  const [transactions, setTransactions] = useState([]);
  const [allTransactions, setAllTransactions] = useState([]);
  const [allTransactionsLoading, setAllTransactionsLoading] = useState(false);
  const [archiveTransactions, setArchiveTransactions] = useState([]);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [categories, setCategories] = useState([]);
  const [years, setYears] = useState([]);
  const [form, setForm] = useState(defaultForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [darkMode, setDarkMode] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [categoryForm, setCategoryForm] = useState({ name: '', type: 'expense' });
  const [currencyCode, setCurrencyCode] = useState('LKR');
  const [currencyRates, setCurrencyRates] = useState({ LKR: 1 });
  const [currencyLoading, setCurrencyLoading] = useState(false);
  const currencyInitializationStarted = useRef(false);

  const currencyLocale = currencyLocales[currencyCode] || 'en-LK';
  const exchangeRate = currencyRates[currencyCode] || 1;
  const currencyFormatter = useMemo(() => new Intl.NumberFormat(currencyLocale, {
    style: 'currency',
    currency: currencyCode,
    maximumFractionDigits: 2
  }), [currencyCode, currencyLocale]);
  const formatCurrency = (amount) => currencyFormatter.format(Number(amount || 0) * exchangeRate);

  const saveCurrencyPreference = (nextCurrency) => {
    try {
      localStorage.setItem('finora_currency', nextCurrency);
    } catch (error) {
      console.error('Could not save currency preference:', error);
      setMessage('Currency changed for this session, but the preference could not be saved.');
    }
  };

  const changeCurrency = async (nextCurrency, notify = true) => {
    if (nextCurrency === currencyCode || currencyLoading) return;

    if (nextCurrency === 'LKR') {
      saveCurrencyPreference(nextCurrency);
      setForm((currentForm) => currentForm.amount
        ? { ...currentForm, amount: String((Number(currentForm.amount) / exchangeRate) * 1) }
        : currentForm);
      setCurrencyCode(nextCurrency);
      setCurrencyRates((rates) => ({ ...rates, LKR: 1 }));
      return;
    }

    const cachedRate = currencyRates[nextCurrency];
    if (cachedRate) {
      saveCurrencyPreference(nextCurrency);
      setForm((currentForm) => currentForm.amount
        ? { ...currentForm, amount: String((Number(currentForm.amount) / exchangeRate) * cachedRate) }
        : currentForm);
      setCurrencyCode(nextCurrency);
      return;
    }

    setCurrencyLoading(true);
    try {
      const response = await fetch('https://open.er-api.com/v6/latest/LKR');
      if (!response.ok) {
        throw new Error('Exchange-rate service is unavailable.');
      }

      const data = await response.json();
      const rate = Number(data.rates?.[nextCurrency]);
      if (data.result !== 'success' || !Number.isFinite(rate) || rate <= 0) {
        throw new Error(`Exchange rate for ${nextCurrency} is unavailable.`);
      }

      saveCurrencyPreference(nextCurrency);
      setForm((currentForm) => currentForm.amount
        ? { ...currentForm, amount: String((Number(currentForm.amount) / exchangeRate) * rate) }
        : currentForm);
      setCurrencyRates((rates) => ({ ...rates, [nextCurrency]: rate }));
      setCurrencyCode(nextCurrency);
      if (notify) {
        setMessage(`Currency changed to ${nextCurrency}. Exchange rates are provided by ExchangeRate-API.`);
      }
    } catch (error) {
      console.error('Currency conversion error:', error);
      setMessage(error.message || 'Could not change currency. Please try again.');
    } finally {
      setCurrencyLoading(false);
    }
  };

  useEffect(() => {
    if (currencyInitializationStarted.current) return;
    currencyInitializationStarted.current = true;

    const savedCurrency = localStorage.getItem('finora_currency');
    if (savedCurrency && currencyOptions.some((option) => option.code === savedCurrency) && savedCurrency !== 'LKR') {
      changeCurrency(savedCurrency, false);
    }
  }, []);

  const fetchAllTransactions = async (authToken = token) => {
    if (!authToken) return;

    setAllTransactionsLoading(true);
    try {
      const query = transactionPeriod
        ? `?month=${encodeURIComponent(transactionPeriod.month)}&year=${encodeURIComponent(transactionPeriod.year)}`
        : '';
      const response = await fetch(`${API_URL}/transactions${query}`, {
        headers: buildHeaders(authToken)
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to fetch transactions.');
      }

      setAllTransactions(data);
    } catch (error) {
      console.error(error);
      setMessage(error.message || 'Failed to load all transactions.');
    } finally {
      setAllTransactionsLoading(false);
    }
  };

  const fetchArchiveTransactions = async (authToken = token) => {
    if (!authToken) return;

    setArchiveLoading(true);
    try {
      const response = await fetch(`${API_URL}/transactions`, {
        headers: buildHeaders(authToken)
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to load transaction archive.');
      }

      setArchiveTransactions(data);
    } catch (error) {
      console.error(error);
      setMessage(error.message || 'Failed to load the transaction archive.');
    } finally {
      setArchiveLoading(false);
    }
  };

  useEffect(() => {
    const handlePopState = () => {
      const isTransactionsPage = window.location.pathname === '/transactions';
      const reportYear = getReportYearFromLocation();
      setShowAllTransactions(isTransactionsPage);
      setShowYearReport(Boolean(reportYear));
      setSelectedReportYear(reportYear);
      const period = getTransactionPeriodFromLocation();
      setTransactionPeriod(period);
      if (period) {
        setSelectedMonth(period.month);
        setSelectedYear(period.year);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (showAllTransactions && token) {
      fetchAllTransactions(token);
    }
  }, [showAllTransactions, token, transactionPeriod?.month, transactionPeriod?.year]);

  useEffect(() => {
    if (token) {
      fetchArchiveTransactions(token);
    }
  }, [token]);

  const navigateToTransactions = (period = null) => {
    const query = period ? `?month=${period.month}&year=${period.year}` : '';
    window.history.pushState({ finoraPage: 'transactions' }, '', `/transactions${query}`);
    setTransactionPeriod(period);
    if (period) {
      setSelectedMonth(period.month);
      setSelectedYear(period.year);
    }
    setShowAllTransactions(true);
    setShowYearReport(false);
    setSelectedReportYear(null);
  };

  const navigateToYear = (year) => {
    const reportYear = String(year);
    window.history.pushState({ finoraPage: 'year-report' }, '', `/reports/years/${reportYear}`);
    setSelectedReportYear(reportYear);
    setShowYearReport(true);
    setShowAllTransactions(false);
    setTransactionPeriod(null);
  };

  const navigateToDashboard = () => {
    window.history.pushState({ finoraPage: 'dashboard' }, '', '/');
    setShowAllTransactions(false);
    setShowYearReport(false);
    setSelectedReportYear(null);
    setTransactionPeriod(null);
  };

  const fetchDashboard = async (authToken = token) => {
    if (!authToken) {
      setLoading(false);
      return;
    }

    try {
      const [summaryRes, transactionsRes, yearsRes, categoriesRes] = await Promise.all([
        fetch(`${API_URL}/summary?month=${selectedMonth}&year=${selectedYear}`, {
          headers: buildHeaders(authToken)
        }),
        fetch(`${API_URL}/transactions?month=${selectedMonth}&year=${selectedYear}`, {
          headers: buildHeaders(authToken)
        }),
        fetch(`${API_URL}/years`, {
          headers: buildHeaders(authToken)
        }),
        fetch(`${API_URL}/categories`, {
          headers: buildHeaders(authToken)
        })
      ]);

      if ([summaryRes, transactionsRes, yearsRes, categoriesRes].some((res) => !res.ok)) {
        throw new Error('Failed to fetch dashboard data');
      }

      const summaryData = await summaryRes.json();
      const transactionData = await transactionsRes.json();
      const yearsData = await yearsRes.json();
      const categoriesData = await categoriesRes.json();

      setSummary(summaryData);
      setTransactions(transactionData);
      setYears(yearsData);
      setCategories(categoriesData);
      setArchiveTransactions((currentArchive) => {
        const filteredIds = new Set(transactionData.map((item) => item.id));
        const otherPeriodTransactions = currentArchive.filter((item) => (
          !filteredIds.has(item.id)
          && (item.date.slice(0, 4) !== selectedYear || item.date.slice(5, 7) !== String(selectedMonth).padStart(2, '0'))
        ));
        return [...otherPeriodTransactions, ...transactionData];
      });
    } catch (error) {
      console.error(error);
      setMessage('Session expired or failed to load data. Please log in again.');
      handleLogout();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const savedToken = getAuthToken();
    if (!savedToken) {
      setLoading(false);
      return;
    }

    setToken(savedToken);
    fetchUser(savedToken);
  }, []);

  useEffect(() => {
    if (token) {
      fetchDashboard(token);
    }
  }, [selectedMonth, selectedYear, token]);

  const fetchUser = async (authToken) => {
    try {
      const response = await fetch(`${API_URL}/auth/me`, {
        headers: buildHeaders(authToken)
      });

      if (!response.ok) {
        throw new Error('Invalid session');
      }

      const data = await response.json();
      setUser(data.user);
    } catch (error) {
      handleLogout();
    }
  };

  const handleAuthInput = (event) => {
    const { name, value } = event.target;
    setAuthForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleAuthSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/auth/${authMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: authForm.name,
          email: authForm.email,
          password: authForm.password
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Authentication failed');
      }

      saveToken(data.token);
      setToken(data.token);
      setUser(data.user);
      setAuthForm(defaultAuth);
      setMessage(authMode === 'login' ? 'Welcome back!' : 'Account created successfully!');
    } catch (error) {
      setMessage(error.message || 'Authorization error');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    removeToken();
    window.history.replaceState({}, '', '/');
    setToken(null);
    setUser(null);
    setShowAllTransactions(false);
    setShowYearReport(false);
    setSelectedReportYear(null);
    setTransactionPeriod(null);
    setTransactions([]);
    setAllTransactions([]);
    setArchiveTransactions([]);
    setCategories([]);
    setSummary({ summary: { income: 0, expense: 0, balance: 0 }, monthlyBreakdown: [], categoryBreakdown: [] });
    setYears([]);
  };

  const dashboardTitle = useMemo(() => {
    const selected = monthNames[Number(selectedMonth) - 1] || 'All';
    return `${selected} ${selectedYear}`;
  }, [selectedMonth, selectedYear]);

  const yearlySummaries = useMemo(() => {
    const totalsByYear = new Map();

    archiveTransactions.forEach((item) => {
      const year = item.date.slice(0, 4);
      const totals = totalsByYear.get(year) || { year, income: 0, expense: 0 };
      totals[item.type] += Number(item.amount || 0);
      totalsByYear.set(year, totals);
    });

    return [...totalsByYear.values()]
      .map((totals) => ({ ...totals, balance: totals.income - totals.expense }))
      .sort((a, b) => Number(b.year) - Number(a.year));
  }, [archiveTransactions]);

  const monthlyReportSummaries = useMemo(() => {
    if (!selectedReportYear) return [];

    const totalsByMonth = new Map();
    archiveTransactions
      .filter((item) => item.date.slice(0, 4) === selectedReportYear)
      .forEach((item) => {
        const month = Number(item.date.slice(5, 7));
        const totals = totalsByMonth.get(month) || { month, income: 0, expense: 0 };
        totals[item.type] += Number(item.amount || 0);
        totalsByMonth.set(month, totals);
      });

    return Array.from({ length: 12 }, (_, index) => {
      const month = 12 - index;
      const totals = totalsByMonth.get(month) || { month, income: 0, expense: 0 };
      return { ...totals, balance: totals.income - totals.expense };
    });
  }, [archiveTransactions, selectedReportYear]);

  const yearReportTotals = useMemo(() => monthlyReportSummaries.reduce(
    (totals, month) => ({
      income: totals.income + month.income,
      expense: totals.expense + month.expense,
      balance: totals.balance + month.balance
    }),
    { income: 0, expense: 0, balance: 0 }
  ), [monthlyReportSummaries]);

  const monthReportTotals = useMemo(() => {
    const totals = allTransactions.reduce(
      (result, item) => {
        result[item.type] += Number(item.amount || 0);
        return result;
      },
      { income: 0, expense: 0 }
    );

    return { ...totals, balance: totals.income - totals.expense };
  }, [allTransactions]);

  const searchTransactionsForPeriod = () => {
    navigateToTransactions({ month: selectedMonth, year: selectedYear });
  };

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);

    try {
      const payload = { ...form, amount: Number(form.amount) / exchangeRate };
      const url = editingId ? `${API_URL}/transactions/${editingId}` : `${API_URL}/transactions`;
      const method = editingId ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: buildHeaders(token),
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Unable to save transaction');
      }

      setForm({ ...defaultForm, date: new Date().toISOString().split('T')[0] });
      setEditingId(null);
      setMessage(editorMessage(method));
      fetchDashboard();
      fetchArchiveTransactions();
      if (showAllTransactions) fetchAllTransactions();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const editorMessage = (method) => (method === 'PUT' ? 'Transaction updated successfully.' : 'Transaction added successfully.');

  const handleEdit = (item) => {
    setEditingId(item.id);
    setForm({
      type: item.type,
      category: item.category,
      amount: String(Number(item.amount) * exchangeRate),
      note: item.note || '',
      date: item.date
    });
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this transaction?')) return;

    try {
      const response = await fetch(`${API_URL}/transactions/${id}`, {
        method: 'DELETE',
        headers: buildHeaders(token)
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to delete transaction');
      }

      setMessage('Transaction deleted successfully.');
      fetchDashboard();
      fetchArchiveTransactions();
      if (showAllTransactions) fetchAllTransactions();
    } catch (error) {
      setMessage(error.message);
    }
  };

  const addCategory = async (event) => {
    event.preventDefault();

    try {
      const response = await fetch(`${API_URL}/categories`, {
        method: 'POST',
        headers: buildHeaders(token),
        body: JSON.stringify(categoryForm)
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Could not add category');
      }

      setCategoryForm({ name: '', type: 'expense' });
      setMessage('Category created successfully.');
      fetchDashboard();
    } catch (error) {
      setMessage(error.message);
    }
  };

  const removeCategory = async (id) => {
    try {
      const response = await fetch(`${API_URL}/categories/${id}`, {
        method: 'DELETE',
        headers: buildHeaders(token)
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to delete category');
      }

      setMessage('Category removed.');
      fetchDashboard();
    } catch (error) {
      setMessage(error.message);
    }
  };

  const downloadPdf = async () => {
    try {
    const logoDataUrl = await loadLogoDataUrl();
    const doc = new jsPDF();
    const reportTransactions = showAllTransactions ? allTransactions : transactions;
    const income = reportTransactions.reduce(
      (total, item) => total + (item.type === 'income' ? Number(item.amount || 0) : 0),
      0
    );
    const expense = reportTransactions.reduce(
      (total, item) => total + (item.type === 'expense' ? Number(item.amount || 0) : 0),
      0
    );
    const balance = income - expense;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    const tableWidth = pageWidth - margin * 2;
    const reportTitle = showAllTransactions && !transactionPeriod
      ? 'All Transactions'
      : dashboardTitle;
    const formatAmount = (amount) => new Intl.NumberFormat(currencyLocale, {
      style: 'currency',
      currency: currencyCode,
      currencyDisplay: 'code',
      maximumFractionDigits: 2
    }).format(Number(amount || 0) * exchangeRate).replace(/\u00a0/g, ' ');

    const drawTableHeader = (y) => {
      doc.setFillColor(79, 70, 229);
      doc.roundedRect(margin, y, tableWidth, 10, 2, 2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      doc.text('DATE', margin + 4, y + 6.5);
      doc.text('TYPE', margin + 31, y + 6.5);
      doc.text('CATEGORY', margin + 54, y + 6.5);
      doc.text('NOTE', margin + 94, y + 6.5);
      doc.text('AMOUNT', pageWidth - margin - 4, y + 6.5, { align: 'right' });
    };

    doc.setFillColor(23, 37, 84);
    doc.rect(0, 0, pageWidth, 48, 'F');
    doc.setFillColor(124, 58, 237);
    doc.rect(0, 44, pageWidth, 4, 'F');
    doc.addImage(logoDataUrl, 'PNG', margin, 7, 32, 32);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(21);
    doc.text('Finora Budget', margin + 38, 21);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('PERSONAL FINANCE REPORT', margin + 38, 29);
    doc.setFontSize(9);
    doc.text(`${reportTitle}  |  Prepared for ${user.name}`, margin + 38, 38);

    const cardY = 58;
    const cardGap = 5;
    const cardWidth = (tableWidth - cardGap * 2) / 3;
    const cards = [
      { label: 'TOTAL INCOME', value: formatAmount(income), color: [5, 150, 105] },
      { label: 'TOTAL EXPENSE', value: formatAmount(expense), color: [220, 38, 38] },
      { label: 'NET BALANCE', value: formatAmount(balance), color: [79, 70, 229] }
    ];

    cards.forEach((card, index) => {
      const x = margin + index * (cardWidth + cardGap);
      doc.setFillColor(245, 247, 255);
      doc.roundedRect(x, cardY, cardWidth, 27, 3, 3, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(card.label, x + 5, cardY + 8);
      doc.setFontSize(11);
      doc.setTextColor(...card.color);
      doc.text(card.value, x + 5, cardY + 19);
    });

    doc.setTextColor(23, 37, 84);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('Transaction details', margin, 101);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`${reportTransactions.length} transactions`, pageWidth - margin, 101, { align: 'right' });

    let y = 108;
    drawTableHeader(y);
    y += 10;

    reportTransactions.forEach((item, index) => {
      const date = new Date(`${item.date}T00:00:00`).toLocaleDateString('en-GB');
      const note = doc.splitTextToSize(item.note || '—', 50).slice(0, 2);
      const rowHeight = Math.max(10, note.length * 4 + 5);

      if (y + rowHeight > pageHeight - 18) {
        doc.addPage();
        y = 18;
        drawTableHeader(y);
        y += 10;
      }

      if (index % 2 === 0) {
        doc.setFillColor(246, 248, 252);
        doc.rect(margin, y, tableWidth, rowHeight, 'F');
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(51, 65, 85);
      doc.text(date, margin + 4, y + 6.5);
      doc.text(item.type.toUpperCase(), margin + 31, y + 6.5);
      doc.text(doc.splitTextToSize(item.category, 34).slice(0, 1), margin + 54, y + 6.5);
      doc.text(note, margin + 94, y + 6.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...(item.type === 'income' ? [5, 150, 105] : [220, 38, 38]));
      doc.text(formatAmount(item.amount), pageWidth - margin - 4, y + 6.5, { align: 'right' });
      y += rowHeight;
    });

    if (!reportTransactions.length) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text('No transactions found for this period.', margin + 4, y + 8);
    }

    for (let page = 1; page <= doc.internal.getNumberOfPages(); page += 1) {
      doc.setPage(page);
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text('Finora Budget  •  Confidential', margin, pageHeight - 7);
      doc.text(`Page ${page} of ${doc.internal.getNumberOfPages()}`, pageWidth - margin, pageHeight - 7, { align: 'right' });
    }

    const filenamePeriod = transactionPeriod || { month: selectedMonth, year: selectedYear };
    const filename = showAllTransactions && !transactionPeriod
      ? 'finora-all-transactions.pdf'
      : `finora-report-${filenamePeriod.year}-${String(filenamePeriod.month).padStart(2, '0')}.pdf`;
    doc.save(filename);
    } catch (error) {
      console.error('PDF download error:', error);
      setMessage(error.message || 'Could not create the PDF report.');
    }
  };

  const downloadYearPdf = async () => {
    try {
    const logoDataUrl = await loadLogoDataUrl();
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    const tableWidth = pageWidth - margin * 2;
    const reportTitle = `${selectedReportYear} Yearly Report`;
    const formatReportAmount = (amount) => new Intl.NumberFormat(currencyLocale, {
      style: 'currency',
      currency: currencyCode,
      currencyDisplay: 'code',
      maximumFractionDigits: 2
    }).format(Number(amount || 0) * exchangeRate).replace(/\u00a0/g, ' ');

    doc.setFillColor(23, 37, 84);
    doc.rect(0, 0, pageWidth, 48, 'F');
    doc.setFillColor(124, 58, 237);
    doc.rect(0, 44, pageWidth, 4, 'F');
    doc.addImage(logoDataUrl, 'PNG', margin, 7, 32, 32);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(21);
    doc.text('Finora Budget', margin + 38, 21);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('YEARLY FINANCE REPORT', margin + 38, 29);
    doc.setFontSize(9);
    doc.text(`${reportTitle}  |  Prepared for ${user.name}`, margin + 38, 38);

    const cardGap = 5;
    const cardWidth = (tableWidth - cardGap * 2) / 3;
    [
      { label: 'TOTAL INCOME', value: yearReportTotals.income, color: [5, 150, 105] },
      { label: 'TOTAL EXPENSE', value: yearReportTotals.expense, color: [220, 38, 38] },
      { label: 'NET BALANCE', value: yearReportTotals.balance, color: [79, 70, 229] }
    ].forEach((card, index) => {
      const x = margin + index * (cardWidth + cardGap);
      doc.setFillColor(245, 247, 255);
      doc.roundedRect(x, 58, cardWidth, 27, 3, 3, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(card.label, x + 5, 66);
      doc.setFontSize(11);
      doc.setTextColor(...card.color);
      doc.text(formatReportAmount(card.value), x + 5, 77);
    });

    const drawMonthlyHeader = (y) => {
      doc.setFillColor(79, 70, 229);
      doc.roundedRect(margin, y, tableWidth, 10, 2, 2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      doc.text('MONTH', margin + 4, y + 6.5);
      doc.text('TOTAL INCOME', margin + 54, y + 6.5);
      doc.text('TOTAL EXPENSE', margin + 105, y + 6.5);
      doc.text('NET BALANCE', pageWidth - margin - 4, y + 6.5, { align: 'right' });
    };

    doc.setTextColor(23, 37, 84);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('Monthly breakdown', margin, 101);
    let y = 108;
    drawMonthlyHeader(y);
    y += 10;

    monthlyReportSummaries.forEach((month, index) => {
      if (y + 10 > pageHeight - 18) {
        doc.addPage();
        y = 18;
        drawMonthlyHeader(y);
        y += 10;
      }

      if (index % 2 === 0) {
        doc.setFillColor(246, 248, 252);
        doc.rect(margin, y, tableWidth, 10, 'F');
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(51, 65, 85);
      doc.text(monthNames[month.month - 1], margin + 4, y + 6.5);
      doc.setTextColor(5, 150, 105);
      doc.text(formatReportAmount(month.income), margin + 54, y + 6.5);
      doc.setTextColor(220, 38, 38);
      doc.text(formatReportAmount(month.expense), margin + 105, y + 6.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(79, 70, 229);
      doc.text(formatReportAmount(month.balance), pageWidth - margin - 4, y + 6.5, { align: 'right' });
      y += 10;
    });

    if (!monthlyReportSummaries.length) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text('No transactions found for this year.', margin + 4, y + 8);
    }

    for (let page = 1; page <= doc.internal.getNumberOfPages(); page += 1) {
      doc.setPage(page);
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text('Finora Budget  •  Confidential', margin, pageHeight - 7);
      doc.text(`Page ${page} of ${doc.internal.getNumberOfPages()}`, pageWidth - margin, pageHeight - 7, { align: 'right' });
    }

    doc.save(`finora-yearly-report-${selectedReportYear}.pdf`);
    } catch (error) {
      console.error('Yearly PDF download error:', error);
      setMessage(error.message || 'Could not create the yearly PDF report.');
    }
  };

  const totalTransactions = transactions.length;

  const incomeChartData = useMemo(() => ({
    labels: summary.monthlyBreakdown.slice(0, 6).map((item) => new Date(`${item.monthKey}-01T00:00:00`).toLocaleString('en-US', { month: 'short', year: '2-digit' })),
    datasets: [
      {
        label: 'Income',
        data: summary.monthlyBreakdown.slice(0, 6).map((item) => Number(item.income || 0) * exchangeRate),
        backgroundColor: '#34d399'
      },
      {
        label: 'Expense',
        data: summary.monthlyBreakdown.slice(0, 6).map((item) => Number(item.expense || 0) * exchangeRate),
        backgroundColor: '#f87171'
      }
    ]
  }), [summary, exchangeRate]);

  const categoryChartData = useMemo(() => ({
    labels: summary.categoryBreakdown.map((item) => item.category),
    datasets: [{
      data: summary.categoryBreakdown.map((item) => Number(item.total || 0) * exchangeRate),
      backgroundColor: ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#c084fc', '#2dd4bf', '#f59e0b', '#fb7185'],
      borderWidth: 0
    }]
  }), [summary, exchangeRate]);

  if (!token || !user) {
    return (
      <div className={darkMode ? 'app-shell dark' : 'app-shell light'}>
        <div className="auth-card">
          <div className="brand">
            <img className="brand-logo" src={LOGO_URL} alt="Finora Budget logo" />
            <div>
              <p>Finance Portal</p>
              <h2>Finora Budget</h2>
            </div>
          </div>

          <div className="auth-switcher">
            <button className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>Login</button>
            <button className={authMode === 'signup' ? 'active' : ''} onClick={() => setAuthMode('signup')}>Sign Up</button>
          </div>

          <form onSubmit={handleAuthSubmit} className="auth-form">
            {authMode === 'signup' && (
              <div className="field-group">
                <label>Name</label>
                <input name="name" value={authForm.name} onChange={handleAuthInput} placeholder="Full name" required />
              </div>
            )}

            <div className="field-group">
              <label>Email</label>
              <input name="email" type="email" value={authForm.email} onChange={handleAuthInput} placeholder="you@example.com" required />
            </div>

            <div className="field-group">
              <label>Password</label>
              <input name="password" type="password" value={authForm.password} onChange={handleAuthInput} placeholder="Password" required />
            </div>

            <button type="submit" className="primary-btn" disabled={loading}>
              {loading ? 'Please wait...' : authMode === 'login' ? 'Login' : 'Create Account'}
            </button>
          </form>

          <div className="demo-box">
            <strong>Demo account</strong>
            <span>Email: demo@finora.com</span>
            <span>Password: demo123</span>
          </div>

          {message && <p className="status-message">{message}</p>}
        </div>
      </div>
    );
  }

  if (showYearReport) {
    return (
      <div className={darkMode ? 'app-shell dark' : 'app-shell light'}>
        <header className="topbar">
          <div className="brand compact-brand">
            <img className="brand-logo" src={LOGO_URL} alt="Finora Budget logo" />
            <div>
              <p>Finance Portal</p>
              <h1>{selectedReportYear} Yearly Report</h1>
            </div>
          </div>
          <div className="topbar-actions">
            <button className="ghost-btn" onClick={() => setDarkMode((prev) => !prev)}>
              {darkMode ? 'Light mode' : 'Dark mode'}
            </button>
            <label className="currency-control">
              <span>Change currency</span>
              <select
                aria-label="Change currency"
                value={currencyCode}
                onChange={(event) => changeCurrency(event.target.value)}
                disabled={currencyLoading}
              >
                {currencyOptions.map((option) => (
                  <option key={option.code} value={option.code}>{option.code}</option>
                ))}
              </select>
            </label>
            <button className="primary-btn" onClick={downloadYearPdf} disabled={archiveLoading}>Download PDF</button>
            <button className="secondary-btn" onClick={navigateToDashboard}>Back to dashboard</button>
          </div>
        </header>

        <section className="summary-grid report-summary-grid">
          <article className="summary-card income">
            <span>Total Yearly Income</span>
            <strong>{formatCurrency(yearReportTotals.income)}</strong>
          </article>
          <article className="summary-card expense">
            <span>Total Yearly Expense</span>
            <strong>{formatCurrency(yearReportTotals.expense)}</strong>
          </article>
          <article className="summary-card balance">
            <span>Yearly Net Balance</span>
            <strong>{formatCurrency(yearReportTotals.balance)}</strong>
          </article>
        </section>

        <section className="panel archive-panel">
          <div className="panel-header">
            <div>
              <h2>Monthly breakdown</h2>
              <span>Select a month to view all its transactions</span>
            </div>
            <span>{monthlyReportSummaries.length} months</span>
          </div>
          {archiveLoading ? (
            <p className="empty-note">Loading monthly summaries...</p>
          ) : monthlyReportSummaries.length ? (
            <div className="report-card-grid">
              {monthlyReportSummaries.map((month) => (
                <button
                  type="button"
                  className="report-card"
                  key={month.month}
                  onClick={() => navigateToTransactions({
                    month: String(month.month),
                    year: selectedReportYear
                  })}
                >
                  <span>{monthNames[month.month - 1]}</span>
                  <strong>{formatCurrency(month.balance)}</strong>
                  <small>Net balance</small>
                  <span className="report-card-detail">
                    Income {formatCurrency(month.income)} · Expense {formatCurrency(month.expense)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="empty-note">No transactions found for this year.</p>
          )}
        </section>

        {message && <div className="toast">{message}</div>}
      </div>
    );
  }

  if (showAllTransactions) {
    return (
      <div className={darkMode ? 'app-shell dark' : 'app-shell light'}>
        <header className="topbar">
          <div className="brand compact-brand">
            <img className="brand-logo" src={LOGO_URL} alt="Finora Budget logo" />
            <div>
              <p>Finance Portal</p>
              <h1>{transactionPeriod ? `${dashboardTitle} Transactions` : 'All Transactions'}</h1>
            </div>
          </div>
          <div className="topbar-actions">
            <button className="ghost-btn" onClick={() => setDarkMode((prev) => !prev)}>
              {darkMode ? 'Light mode' : 'Dark mode'}
            </button>
            <label className="currency-control">
              <span>Change currency</span>
              <select
                aria-label="Change currency"
                value={currencyCode}
                onChange={(event) => changeCurrency(event.target.value)}
                disabled={currencyLoading}
              >
                {currencyOptions.map((option) => (
                  <option key={option.code} value={option.code}>{option.code}</option>
                ))}
              </select>
            </label>
            <button className="primary-btn" onClick={downloadPdf}>Download PDF</button>
            <button className="secondary-btn" onClick={navigateToDashboard}>Back to dashboard</button>
          </div>
        </header>

        {transactionPeriod && (
          <section className="summary-grid report-summary-grid">
            <article className="summary-card income">
              <span>Total Monthly Income</span>
              <strong>{formatCurrency(monthReportTotals.income)}</strong>
            </article>
            <article className="summary-card expense">
              <span>Total Monthly Expense</span>
              <strong>{formatCurrency(monthReportTotals.expense)}</strong>
            </article>
            <article className="summary-card balance">
              <span>Monthly Net Balance</span>
              <strong>{formatCurrency(monthReportTotals.balance)}</strong>
            </article>
          </section>
        )}

        <section className="panel table-panel">
          <div className="panel-header">
            <div>
              <h2>{transactionPeriod ? `${dashboardTitle} Transactions` : 'All Transactions'}</h2>
              <span>{transactionPeriod ? `All transactions for ${dashboardTitle}` : 'All recorded transactions'}</span>
            </div>
            <span>{allTransactions.length} entries</span>
          </div>
          <TransactionTable
            items={allTransactions}
            onEdit={handleEdit}
            onDelete={handleDelete}
            formatCurrency={formatCurrency}
          />
        </section>

        {message && <div className="toast">{message}</div>}
        {allTransactionsLoading && <div className="loading">Loading transactions...</div>}
      </div>
    );
  }

  return (
    <div className={darkMode ? 'app-shell dark' : 'app-shell light'}>
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand compact-brand">
            <img className="brand-logo" src={LOGO_URL} alt="Finora Budget logo" />
            <div>
              <p>Finance Portal</p>
              <h1>Finora Budget</h1>
            </div>
          </div>
        </div>

        <div className="topbar-actions">
          <button className="ghost-btn" onClick={() => setDarkMode((prev) => !prev)}>
            {darkMode ? 'Light mode' : 'Dark mode'}
          </button>
          <label className="currency-control">
            <span>Change currency</span>
            <select
              aria-label="Change currency"
              value={currencyCode}
              onChange={(event) => changeCurrency(event.target.value)}
              disabled={currencyLoading}
            >
              {currencyOptions.map((option) => (
                <option key={option.code} value={option.code}>{option.code}</option>
              ))}
            </select>
          </label>
          <button className="primary-btn" onClick={downloadPdf} disabled={allTransactionsLoading}>Download PDF</button>
          <button className="secondary-btn" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <section className="user-card">
        <div>
          <p className="eyebrow">Welcome back</p>
          <h2>{user.name}</h2>
        </div>
        <span>{user.email}</span>
      </section>

      <section className="filters-panel">
        <div className="field-group">
          <label htmlFor="month">Month</label>
          <select id="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
            {monthNames.map((month, index) => (
              <option key={month} value={index + 1}>{month}</option>
            ))}
          </select>
        </div>

        <div className="field-group">
          <label htmlFor="year">Year</label>
          <select id="year" value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)}>
            {[...new Set([...years, Number(selectedYear)])].sort((a, b) => b - a).map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </div>
        <button type="button" className="primary-btn filter-search-btn" onClick={searchTransactionsForPeriod}>
          Search
        </button>
      </section>

      <section className="summary-grid">
        <article className="summary-card income">
          <span>Total Income</span>
          <strong>{formatCurrency(summary.summary?.income || 0)}</strong>
        </article>

        <article className="summary-card expense">
          <span>Total Expense</span>
          <strong>{formatCurrency(summary.summary?.expense || 0)}</strong>
        </article>

        <article className="summary-card balance">
          <span>Net Balance</span>
          <strong>{formatCurrency(summary.summary?.balance || 0)}</strong>
        </article>

        <article className="summary-card transactions-count">
          <span>Transactions</span>
          <strong>{totalTransactions}</strong>
        </article>
      </section>

      <div className="content-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>Income vs Expense</h2>
            <span>{dashboardTitle}</span>
          </div>

          <div className="chart-wrap bar-chart">
            <Bar
              data={incomeChartData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: true } },
                scales: { y: { ticks: { callback: (value) => formatCurrency(value) } } }
              }}
            />
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Category Split</h2>
            <span>Top categories</span>
          </div>

          <div className="chart-wrap donut-chart">
            {summary.categoryBreakdown.length ? (
              <Doughnut
                data={categoryChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                      plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (context) => formatCurrency(context.raw) } } }
                }}
              />
            ) : (
              <p>No category data available.</p>
            )}
          </div>
        </section>
      </div>

      <div className="content-grid bottom-grid">
        <section className="panel form-panel">
          <div className="panel-header">
            <h2>{editingId ? 'Edit Transaction' : 'Add Transaction'}</h2>
            <span>Record income or expense</span>
          </div>

          <form onSubmit={handleSubmit} className="transaction-form">
            <div className="two-col">
              <div className="field-group">
                <label>Type</label>
                <select name="type" value={form.type} onChange={handleInputChange}>
                  <option value="income">Income</option>
                  <option value="expense">Expense</option>
                </select>
              </div>

              <div className="field-group">
                <label>Category</label>
                <select name="category" value={form.category} onChange={handleInputChange} required>
                  <option value="">Select category</option>
                  {categories
                    .filter((category) => category.type === form.type)
                    .map((category) => (
                      <option key={category.id} value={category.name}>{category.name}</option>
                    ))}
                </select>
              </div>
            </div>

            <div className="two-col">
              <div className="field-group">
                <label>Amount ({currencyCode})</label>
                <input type="number" name="amount" value={form.amount} onChange={handleInputChange} min="0.01" step="0.01" required />
              </div>

              <div className="field-group">
                <label>Date</label>
                <input type="date" name="date" value={form.date} onChange={handleInputChange} required />
              </div>
            </div>

            <div className="field-group">
              <label>Note</label>
              <textarea name="note" value={form.note} onChange={handleInputChange} rows="3" placeholder="Add a short note" />
            </div>

            <div className="button-row">
              <button type="submit" className="primary-btn" disabled={submitting}>{submitting ? 'Saving...' : editingId ? 'Update Transaction' : 'Save Transaction'}</button>
              {editingId && (
                <button type="button" className="secondary-btn" onClick={() => { setEditingId(null); setForm({ ...defaultForm, date: new Date().toISOString().split('T')[0] }); }}>
                  Cancel
                </button>
              )}
            </div>
          </form>
        </section>

        <section className="panel category-panel">
          <div className="panel-header">
            <h2>Categories</h2>
            <span>Manage your list</span>
          </div>

          <form className="category-form" onSubmit={addCategory}>
            <div className="two-col smaller-gap">
              <div className="field-group">
                <label>Name</label>
                <input
                  type="text"
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                  placeholder="e.g. Rent"
                  required
                />
              </div>

              <div className="field-group">
                <label>Type</label>
                <select value={categoryForm.type} onChange={(e) => setCategoryForm({ ...categoryForm, type: e.target.value })}>
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </div>
            </div>

            <button type="submit" className="primary-btn">Add Category</button>
          </form>

          <div className="category-list">
            {categories.length ? categories.map((category) => (
              <div className="category-item" key={category.id}>
                <div>
                  <strong>{category.name}</strong>
                  <span>{category.type}</span>
                </div>
                <button type="button" className="delete-btn" onClick={() => removeCategory(category.id)}>Remove</button>
              </div>
            )) : <p className="empty-note">No categories yet.</p>}
          </div>
        </section>
      </div>

      <section className="panel table-panel">
        <div className="panel-header">
          <h2>Transactions</h2>
          <div className="transaction-list-actions">
            <span>{transactions.length} entries</span>
            {transactions.length > 5 && (
              <button type="button" className="see-more-btn" onClick={() => navigateToTransactions()}>See more</button>
            )}
          </div>
        </div>
        <TransactionTable
          items={transactions.slice(0, 5)}
          onEdit={handleEdit}
          onDelete={handleDelete}
          formatCurrency={formatCurrency}
        />
      </section>

      <section className="panel archive-panel">
        <div className="panel-header">
          <div>
            <h2>Yearly summaries</h2>
            <span>Choose a year to browse monthly balances and transactions</span>
          </div>
          <span>{yearlySummaries.length} years</span>
        </div>
        {archiveLoading ? (
          <p className="empty-note">Loading yearly summaries...</p>
        ) : yearlySummaries.length ? (
          <div className="report-card-grid">
            {yearlySummaries.map((year) => (
              <button
                type="button"
                className="report-card"
                key={year.year}
                onClick={() => navigateToYear(year.year)}
              >
                <span>{year.year}</span>
                <strong>{formatCurrency(year.balance)}</strong>
                <small>Yearly net balance</small>
                <span className="report-card-detail">
                  Income {formatCurrency(year.income)} · Expense {formatCurrency(year.expense)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="empty-note">Yearly summaries will appear once transactions have been added.</p>
        )}
      </section>

      {message && <div className="toast">{message}</div>}
      {loading && <div className="loading">Loading dashboard...</div>}
    </div>
  );
}

export default App;
