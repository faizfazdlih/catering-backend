const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');

// Register Client
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

    // Insert user
    const [result] = await db.query(
      'INSERT INTO users (nama, email, password, no_telepon, alamat, status) VALUES (?, ?, ?, ?, ?, ?)',
      [nama, email, hashedPassword, no_telepon, alamat, 'pending']
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

// Login Client
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      return res.status(401).json({ message: 'Email atau password salah' });
    }

    const user = users[0];

    // Check status
    if (user.status === 'pending') {
      return res.status(403).json({ message: 'Akun masih menunggu approval admin' });
    }
    if (user.status === 'rejected') {
      return res.status(403).json({ message: 'Akun ditolak oleh admin' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ message: 'Email atau password salah' });
    }

    // Generate token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login berhasil',
      token,
      user: {
        id: user.id,
        nama: user.nama,
        email: user.email,
        no_telepon: user.no_telepon,
        alamat: user.alamat
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Admin Login (hardcoded for simplicity)
router.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Simple hardcoded admin credentials
    if (username === 'admin' && password === 'admin123') {
      const token = jwt.sign(
        { userId: 0, role: 'admin', username: 'admin' },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.json({
        message: 'Login admin berhasil',
        token,
        admin: { username: 'admin', role: 'admin' }
      });
    } else {
      res.status(401).json({ message: 'Username atau password salah' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get Pending Users (Admin only)
router.get('/admin/pending-users', async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT id, nama, email, no_telepon, alamat, status, created_at FROM users WHERE status = ?',
      ['pending']
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
      'SELECT id, nama, email, no_telepon, alamat, status, created_at FROM users ORDER BY created_at DESC'
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

module.exports = router;