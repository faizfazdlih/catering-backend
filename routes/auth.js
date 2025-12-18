// routes/auth.js - UPDATED
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');

// Register Client (default role: client)
router.post('/register', async (req, res) => {
  try {
    const { nama, email, password, no_telepon, alamat } = req.body;

    // Check if user exists
    const [existing] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ message: 'Email sudah terdaftar' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user dengan role default 'client'
    const [result] = await db.query(
      'INSERT INTO users (nama, email, password, no_telepon, alamat, status, role) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [nama, email, hashedPassword, no_telepon, alamat, 'pending', 'client']
    );

    res.status(201).json({ 
      message: 'Registrasi berhasil. Menunggu approval admin.',
      userId: result.insertId 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Unified Login (Client & Admin)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user by email
    const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      return res.status(401).json({ message: 'Email atau password salah' });
    }

    const user = users[0];

    // Check status (hanya untuk client, admin tidak perlu approval)
    if (user.role === 'client' && user.status === 'pending') {
      return res.status(403).json({ message: 'Akun masih menunggu approval admin' });
    }
    if (user.role === 'client' && user.status === 'rejected') {
      return res.status(403).json({ message: 'Akun ditolak oleh admin' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ message: 'Email atau password salah' });
    }

    // Generate token
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email,
        role: user.role 
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Response berbeda berdasarkan role
    res.json({
      message: 'Login berhasil',
      token,
      role: user.role,
      user: {
        id: user.id,
        nama: user.nama,
        email: user.email,
        no_telepon: user.no_telepon,
        alamat: user.alamat,
        role: user.role
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get Pending Users (Admin only)
router.get('/admin/pending-users', async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT id, nama, email, no_telepon, alamat, status, role, created_at FROM users WHERE status = ? AND role = ?',
      ['pending', 'client']
    );
    res.json({ users });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get All Users (Admin only)
router.get('/admin/users', async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT id, nama, email, no_telepon, alamat, status, role, created_at FROM users ORDER BY created_at DESC'
    );
    res.json({ users });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Approve/Reject User
router.patch('/admin/users/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'approved' or 'rejected'

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Status tidak valid' });
    }

    await db.query('UPDATE users SET status = ? WHERE id = ?', [status, id]);
    
    res.json({ message: `User berhasil ${status === 'approved' ? 'disetujui' : 'ditolak'}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Update User Role (Admin only) - NEW ENDPOINT
router.patch('/admin/users/:id/role', async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body; // 'client' or 'admin'

    if (!['client', 'admin'].includes(role)) {
      return res.status(400).json({ message: 'Role tidak valid' });
    }

    // Jika dirubah jadi admin, otomatis approve
    if (role === 'admin') {
      await db.query('UPDATE users SET role = ?, status = ? WHERE id = ?', [role, 'approved', id]);
    } else {
      await db.query('UPDATE users SET role = ? WHERE id = ?', [role, id]);
    }
    
    res.json({ message: `Role user berhasil diubah menjadi ${role}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Create Admin User (Super Admin only) - OPTIONAL
router.post('/admin/create', async (req, res) => {
  try {
    const { nama, email, password, no_telepon, alamat } = req.body;

    // Check if user exists
    const [existing] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ message: 'Email sudah terdaftar' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert admin user
    const [result] = await db.query(
      'INSERT INTO users (nama, email, password, no_telepon, alamat, status, role) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [nama, email, hashedPassword, no_telepon, alamat, 'approved', 'admin']
    );

    res.status(201).json({ 
      message: 'Admin berhasil dibuat',
      userId: result.insertId 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Root info for easier debugging (GET /api/auth)
router.get('/', (req, res) => {
  res.json({
    message: 'Auth routes root',
    endpoints: {
      register: '/api/auth/register (POST)',
      login: '/api/auth/login (POST)',
      pending_users: '/api/auth/admin/pending-users (GET)',
      users: '/api/auth/admin/users (GET)'
    }
  });
});

module.exports = router;