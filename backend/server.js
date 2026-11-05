const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || (
  process.env.NODE_ENV === 'production' ? null : 'finora-demo-secret-key-change-me'
);

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET must be configured in production.');
}

const dbDir = path.join(__dirname, 'data');
const dbPath = path.join(dbDir, 'finance.db');
const postgres = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

if (!postgres && !fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = postgres ? null : new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
  } else {
    console.log('Connected to SQLite database');
  }
});

const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:4173')
  .split(',')
  .map((origin) => origin.trim());

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

const prepareSql = (sql) => {
  let parameterIndex = 0;
  return sql.replace(/\?/g, () => `$${++parameterIndex}`);
};

const runSql = (sql, params = []) => new Promise((resolve, reject) => {
  if (postgres) {
    const query = prepareSql(sql);
    const isInsert = /^\s*INSERT\s/i.test(query);
    postgres.query(isInsert ? `${query} RETURNING id` : query, params)
      .then((result) => resolve({
        id: result.rows[0]?.id,
        changes: result.rowCount
      }))
      .catch(reject);
    return;
  }

  db.run(sql, params, function (err) {
    if (err) {
      reject(err);
      return;
    }

    resolve({ id: this.lastID, changes: this.changes });
  });
});

const getSql = (sql, params = []) => new Promise((resolve, reject) => {
  if (postgres) {
    postgres.query(prepareSql(sql), params)
      .then((result) => resolve(result.rows[0] || null))
      .catch(reject);
    return;
  }

  db.get(sql, params, (err, row) => {
    if (err) reject(err);
    else resolve(row || null);
  });
});

const allSql = (sql, params = []) => new Promise((resolve, reject) => {
  if (postgres) {
    postgres.query(prepareSql(sql), params)
      .then((result) => resolve(result.rows))
      .catch(reject);
    return;
  }

  db.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows || []);
  });
});

const signToken = (user) => jwt.sign(
  { id: user.id, email: user.email },
  JWT_SECRET,
  { expiresIn: '7d' }
);

const authMiddleware = (req, res, next) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authentication required.' });
  }

  const token = header.replace('Bearer ', '');

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
};

const ensureColumnExists = async (tableName, columnName, columnDefinition) => {
  const tableInfo = postgres
    ? await allSql(
        'SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?',
        [tableName]
      )
    : await allSql(`PRAGMA table_info(${tableName})`);
  const exists = tableInfo.some((column) => column.name === columnName);

  if (!exists) {
    await runSql(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
  }
};

const createTables = async () => {
  const idColumn = postgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  const dateColumn = postgres ? 'DATE NOT NULL' : 'TEXT NOT NULL';
  const createdAtColumn = postgres ? 'TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP' : 'TEXT DEFAULT CURRENT_TIMESTAMP';

  await runSql(`
    CREATE TABLE IF NOT EXISTS users (
      id ${idColumn},
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at ${createdAtColumn}
    )
  `);

  await ensureColumnExists('users', 'name', 'TEXT');
  await ensureColumnExists('users', 'email', 'TEXT');
  await ensureColumnExists('users', 'password_hash', 'TEXT');

  await runSql(`
    CREATE TABLE IF NOT EXISTS categories (
      id ${idColumn},
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
      created_at ${createdAtColumn},
      UNIQUE(user_id, name, type)
    )
  `);

  await ensureColumnExists('categories', 'user_id', 'INTEGER');
  await ensureColumnExists('categories', 'name', 'TEXT');
  await ensureColumnExists('categories', 'type', 'TEXT');

  await runSql(`
    CREATE TABLE IF NOT EXISTS transactions (
      id ${idColumn},
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      date ${dateColumn},
      created_at ${createdAtColumn}
    )
  `);

  await ensureColumnExists('transactions', 'user_id', 'INTEGER');
  await ensureColumnExists('transactions', 'type', 'TEXT');
  await ensureColumnExists('transactions', 'category', 'TEXT');
  await ensureColumnExists('transactions', 'amount', 'REAL');
  await ensureColumnExists('transactions', 'date', 'TEXT');
};

const seedDemoData = async () => {
  const userCount = await getSql('SELECT COUNT(*) AS count FROM users');

  if (!userCount || Number(userCount.count) > 0) {
    return;
  }

  const demoPassword = await bcrypt.hash('demo123', 10);
  const user = await runSql(
    'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
    ['Demo User', 'demo@finora.com', demoPassword]
  );

  const defaultCategories = [
    ['Salary', 'income'],
    ['Freelance', 'income'],
    ['Bonus', 'income'],
    ['Rent', 'expense'],
    ['Groceries', 'expense'],
    ['Transport', 'expense'],
    ['Utilities', 'expense'],
    ['Health', 'expense'],
    ['Travel', 'expense']
  ];

  for (const [name, type] of defaultCategories) {
    await runSql(
      'INSERT INTO categories (user_id, name, type) VALUES (?, ?, ?) ON CONFLICT (user_id, name, type) DO NOTHING',
      [user.id, name, type]
    );
  }

  const demoTransactions = [
    ['income', 'Salary', 185000, 'Monthly salary', '2026-10-01'],
    ['expense', 'Rent', 65000, 'Apartment rent', '2026-10-05'],
    ['expense', 'Groceries', 24000, 'Food and household', '2026-10-08'],
    ['income', 'Freelance', 45000, 'Website project', '2026-10-12'],
    ['expense', 'Transport', 8200, 'Fuel and travel', '2026-10-15'],
    ['expense', 'Utilities', 12000, 'Electricity and water', '2026-10-17'],
    ['income', 'Bonus', 30000, 'Annual bonus', '2026-09-20'],
    ['expense', 'Health', 15000, 'Medical checkup', '2026-09-22'],
    ['income', 'Freelance', 60000, 'Online sales', '2025-12-12'],
    ['expense', 'Travel', 35000, 'Weekend trip', '2025-11-18']
  ];

  for (const [type, category, amount, note, date] of demoTransactions) {
    await runSql(
      'INSERT INTO transactions (user_id, type, category, amount, note, date) VALUES (?, ?, ?, ?, ?, ?)',
      [user.id, type, category, Number(amount), note, date]
    );
  }
};

const initializeDatabase = async () => {
  await createTables();
  await seedDemoData();
  console.log('Database initialized successfully');
};

const databaseReady = initializeDatabase();

app.use(async (req, res, next) => {
  try {
    await databaseReady;
    next();
  } catch (error) {
    console.error('Database initialization failed:', error);
    res.status(503).json({ message: 'Database is unavailable.' });
  }
});

const formatDate = (dateString) => {
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  return date.toISOString().split('T')[0];
};

const getFilterParams = (userId, month, year) => {
  const conditions = ['user_id = ?'];
  const values = [userId];

  if (year) {
    conditions.push(postgres ? 'EXTRACT(YEAR FROM date) = ?' : "strftime('%Y', date) = ?");
    values.push(String(year));
  }

  if (month) {
    conditions.push(postgres ? 'EXTRACT(MONTH FROM date) = ?' : "strftime('%m', date) = ?");
    values.push(String(month).padStart(2, '0'));
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    values
  };
};

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Finance API is running.' });
});

app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Name, email and password are required.' });
  }

  const sanitizedName = String(name).trim();
  const sanitizedEmail = String(email).trim().toLowerCase();

  if (sanitizedName.length < 2) {
    return res.status(400).json({ message: 'Name must be at least 2 characters long.' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sanitizedEmail)) {
    return res.status(400).json({ message: 'Please enter a valid email address.' });
  }

  if (String(password).length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters long.' });
  }

  try {
    const existingUser = await getSql('SELECT id FROM users WHERE email = ?', [sanitizedEmail]);
    if (existingUser) {
      return res.status(409).json({ message: 'An account already exists with this email.' });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const result = await runSql(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      [sanitizedName, sanitizedEmail, passwordHash]
    );

    const user = { id: result.id, name: sanitizedName, email: sanitizedEmail };

    return res.status(201).json({
      message: 'Account created successfully.',
      token: signToken(user),
      user
    });
  } catch (error) {
    console.error('Signup error:', error.message);
    return res.status(500).json({ message: 'Could not create user account.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  try {
    const user = await getSql('SELECT * FROM users WHERE email = ?', [String(email).trim().toLowerCase()]);

    if (!user) {
      return res.status(401).json({ message: 'Incorrect email or password.' });
    }

    const isValid = await bcrypt.compare(String(password), user.password_hash);

    if (!isValid) {
      return res.status(401).json({ message: 'Incorrect email or password.' });
    }

    const safeUser = { id: user.id, name: user.name, email: user.email };

    return res.json({
      message: 'Login successful.',
      token: signToken(safeUser),
      user: safeUser
    });
  } catch (error) {
    console.error('Login error:', error.message);
    return res.status(500).json({ message: 'Login failed.' });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const user = await getSql('SELECT id, name, email FROM users WHERE id = ?', [req.user.id]);

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    return res.json({ user });
  } catch (error) {
    console.error('Auth me error:', error.message);
    return res.status(500).json({ message: 'Could not fetch profile.' });
  }
});

app.get('/api/categories', authMiddleware, async (req, res) => {
  try {
    const categories = await allSql(
      'SELECT * FROM categories WHERE user_id = ? ORDER BY type ASC, name ASC',
      [req.user.id]
    );

    return res.json(categories);
  } catch (error) {
    console.error('Categories fetch error:', error.message);
    return res.status(500).json({ message: 'Failed to fetch categories.' });
  }
});

app.post('/api/categories', authMiddleware, async (req, res) => {
  const { name, type } = req.body;

  if (!name || !type) {
    return res.status(400).json({ message: 'Category name and type are required.' });
  }

  const trimmedName = String(name).trim();
  const normalizedType = String(type).toLowerCase();

  if (!['income', 'expense'].includes(normalizedType)) {
    return res.status(400).json({ message: 'Category type must be income or expense.' });
  }

  if (trimmedName.length < 2) {
    return res.status(400).json({ message: 'Category name must have at least 2 characters.' });
  }

  try {
    const existingCategory = await getSql(
      'SELECT id FROM categories WHERE user_id = ? AND name = ? AND type = ?',
      [req.user.id, trimmedName, normalizedType]
    );

    if (existingCategory) {
      return res.status(409).json({ message: 'This category already exists.' });
    }

    const result = await runSql(
      'INSERT INTO categories (user_id, name, type) VALUES (?, ?, ?)',
      [req.user.id, trimmedName, normalizedType]
    );

    return res.status(201).json({
      message: 'Category created successfully.',
      category: {
        id: result.id,
        user_id: req.user.id,
        name: trimmedName,
        type: normalizedType
      }
    });
  } catch (error) {
    console.error('Category create error:', error.message);
    return res.status(500).json({ message: 'Failed to create category.' });
  }
});

app.delete('/api/categories/:id', authMiddleware, async (req, res) => {
  try {
    const category = await getSql('SELECT id FROM categories WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);

    if (!category) {
      return res.status(404).json({ message: 'Category not found.' });
    }

    await runSql('DELETE FROM categories WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    return res.json({ message: 'Category deleted successfully.' });
  } catch (error) {
    console.error('Category delete error:', error.message);
    return res.status(500).json({ message: 'Failed to delete category.' });
  }
});

app.get('/api/summary', authMiddleware, async (req, res) => {
  const { month, year } = req.query;

  try {
    const filter = getFilterParams(req.user.id, month, year);
    const totals = await allSql(
      `SELECT type, SUM(amount) AS total
       FROM transactions
       ${filter.whereClause}
       GROUP BY type`,
      filter.values
    );

    const summary = {
      income: 0,
      expense: 0,
      balance: 0
    };

    totals.forEach((row) => {
      if (row.type === 'income') summary.income = Number(row.total || 0);
      if (row.type === 'expense') summary.expense = Number(row.total || 0);
    });

    summary.balance = summary.income - summary.expense;

    const monthExpression = postgres ? "TO_CHAR(date, 'YYYY-MM')" : "strftime('%Y-%m', date)";
    const monthKeyAlias = postgres ? '"monthKey"' : 'monthKey';
    const monthlyBreakdown = await allSql(
      `SELECT ${monthExpression} AS ${monthKeyAlias},
              SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS income,
              SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expense
       FROM transactions
       ${filter.whereClause}
       GROUP BY ${monthExpression}
       ORDER BY ${monthKeyAlias} DESC`,
      filter.values
    );

    const categoryBreakdown = await allSql(
      `SELECT category, type, SUM(amount) AS total
       FROM transactions
       ${filter.whereClause}
       GROUP BY category, type
       ORDER BY total DESC
       LIMIT 10`,
      filter.values
    );

    return res.json({
      summary,
      monthlyBreakdown: monthlyBreakdown.map((row) => ({
        ...row,
        income: Number(row.income || 0),
        expense: Number(row.expense || 0)
      })),
      categoryBreakdown: categoryBreakdown.map((row) => ({
        ...row,
        total: Number(row.total || 0)
      }))
    });
  } catch (error) {
    console.error('Summary query error:', error.message);
    return res.status(500).json({ message: 'Failed to load summary data.' });
  }
});

app.get('/api/transactions', authMiddleware, async (req, res) => {
  const { month, year } = req.query;

  try {
    const filter = getFilterParams(req.user.id, month, year);
    const rows = await allSql(
      `SELECT * FROM transactions
       ${filter.whereClause}
       ORDER BY date DESC, id DESC`,
      filter.values
    );

    return res.json(rows.map((row) => ({
      ...row,
      amount: Number(row.amount)
    })));
  } catch (error) {
    console.error('Transactions fetch error:', error.message);
    return res.status(500).json({ message: 'Failed to fetch transactions.' });
  }
});

app.post('/api/transactions', authMiddleware, async (req, res) => {
  const { type, category, amount, note, date } = req.body;

  if (!type || !category || !amount || !date) {
    return res.status(400).json({ message: 'Type, category, amount and date are required.' });
  }

  if (!['income', 'expense'].includes(String(type).toLowerCase())) {
    return res.status(400).json({ message: 'Type must be income or expense.' });
  }

  const parsedAmount = Number(amount);
  if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ message: 'Amount must be a positive number.' });
  }

  try {
    const normalizedType = String(type).toLowerCase();
    const normalizedCategory = String(category).trim();
    const transactionDate = formatDate(date);

    await runSql(
      'INSERT INTO transactions (user_id, type, category, amount, note, date) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, normalizedType, normalizedCategory, parsedAmount, String(note || '').trim(), transactionDate]
    );

    return res.status(201).json({ message: 'Transaction added successfully.' });
  } catch (error) {
    console.error('Transaction create error:', error.message);
    return res.status(500).json({ message: 'Failed to add transaction.' });
  }
});

app.put('/api/transactions/:id', authMiddleware, async (req, res) => {
  const { type, category, amount, note, date } = req.body;

  if (!type || !category || !amount || !date) {
    return res.status(400).json({ message: 'Type, category, amount and date are required.' });
  }

  try {
    const existing = await getSql(
      'SELECT id FROM transactions WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (!existing) {
      return res.status(404).json({ message: 'Transaction not found.' });
    }

    const parsedAmount = Number(amount);
    if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ message: 'Amount must be a positive number.' });
    }

    await runSql(
      'UPDATE transactions SET type = ?, category = ?, amount = ?, note = ?, date = ? WHERE id = ? AND user_id = ?',
      [String(type).toLowerCase(), String(category).trim(), parsedAmount, String(note || '').trim(), formatDate(date), req.params.id, req.user.id]
    );

    return res.json({ message: 'Transaction updated successfully.' });
  } catch (error) {
    console.error('Transaction update error:', error.message);
    return res.status(500).json({ message: 'Failed to update transaction.' });
  }
});

app.delete('/api/transactions/:id', authMiddleware, async (req, res) => {
  try {
    const existing = await getSql(
      'SELECT id FROM transactions WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (!existing) {
      return res.status(404).json({ message: 'Transaction not found.' });
    }

    await runSql('DELETE FROM transactions WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    return res.json({ message: 'Transaction deleted successfully.' });
  } catch (error) {
    console.error('Transaction delete error:', error.message);
    return res.status(500).json({ message: 'Failed to delete transaction.' });
  }
});

app.get('/api/years', authMiddleware, async (req, res) => {
  try {
    const rows = await allSql(
      postgres
        ? 'SELECT DISTINCT EXTRACT(YEAR FROM date) AS year FROM transactions WHERE user_id = ? ORDER BY year DESC'
        : 'SELECT DISTINCT strftime(\'%Y\', date) AS year FROM transactions WHERE user_id = ? ORDER BY year DESC',
      [req.user.id]
    );

    return res.json(rows.map((row) => Number(row.year)));
  } catch (error) {
    console.error('Fetch years error:', error.message);
    return res.status(500).json({ message: 'Failed to fetch years.' });
  }
});

if (require.main === module) {
  databaseReady
    .then(() => {
    app.listen(PORT, () => {
      console.log(`Backend server running on port ${PORT}`);
    });
    })
    .catch((error) => {
      console.error('Database initialization failed:', error);
      process.exit(1);
    });
}

module.exports = app;
