// routes/menu.js
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const upload = require('../config/upload');
const fs = require('fs');
const path = require('path');

// Get All Menu
router.get('/', async (req, res) => {
  try {
    const [menu] = await db.query(
      'SELECT * FROM menu WHERE status = ? ORDER BY kategori, nama_menu',
      ['tersedia']
    );
    res.json({ menu });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get Menu by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [menu] = await db.query('SELECT * FROM menu WHERE id = ?', [id]);
    
    if (menu.length === 0) {
      return res.status(404).json({ message: 'Menu tidak ditemukan' });
    }
    
    res.json({ menu: menu[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Add Menu (Admin only) - WITH IMAGE UPLOAD
router.post('/', upload.single('foto'), async (req, res) => {
  try {
    const { nama_menu, deskripsi, harga, kategori } = req.body;
    
    // Get uploaded file path
    const foto_url = req.file ? `/uploads/menu/${req.file.filename}` : null;
    const foto_filename = req.file ? req.file.filename : null;

    const [result] = await db.query(
      'INSERT INTO menu (nama_menu, deskripsi, harga, kategori, foto_url, foto_filename) VALUES (?, ?, ?, ?, ?, ?)',
      [nama_menu, deskripsi, harga, kategori, foto_url, foto_filename]
    );

    res.status(201).json({ 
      message: 'Menu berhasil ditambahkan',
      menuId: result.insertId,
      foto_url: foto_url
    });
  } catch (error) {
    console.error(error);
    
    // Delete uploaded file if database insert fails
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// routes/menu.js - UPDATE Menu route
router.put('/:id', upload.single('foto'), async (req, res) => {
  try {
    const { id } = req.params;
    const { nama_menu, deskripsi, harga, kategori, status, foto_url } = req.body;
    
    // Get old menu data
    const [oldMenu] = await db.query('SELECT foto_filename, foto_url FROM menu WHERE id = ?', [id]);
    
    let newFotoUrl = null;
    let newFotoFilename = null;
    
    // CASE 1: User upload gambar baru
    if (req.file) {
      newFotoUrl = `/uploads/menu/${req.file.filename}`;
      newFotoFilename = req.file.filename;
      
      // Delete old file if exists
      if (oldMenu[0]?.foto_filename) {
        const oldFilePath = path.join(__dirname, '../uploads/menu', oldMenu[0].foto_filename);
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
        }
      }
    } 
    // CASE 2: User ingin hapus gambar (foto_url = undefined/null dari frontend)
    else if (foto_url === undefined || foto_url === 'null' || foto_url === '') {
      // Delete old file
      if (oldMenu[0]?.foto_filename) {
        const oldFilePath = path.join(__dirname, '../uploads/menu', oldMenu[0].foto_filename);
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
        }
      }
      newFotoUrl = null;
      newFotoFilename = null;
    }
    // CASE 3: Keep existing image
    else if (foto_url) {
      newFotoUrl = oldMenu[0]?.foto_url;
      newFotoFilename = oldMenu[0]?.foto_filename;
    }

    await db.query(
      'UPDATE menu SET nama_menu = ?, deskripsi = ?, harga = ?, kategori = ?, foto_url = ?, foto_filename = ?, status = ? WHERE id = ?',
      [nama_menu, deskripsi, harga, kategori, newFotoUrl, newFotoFilename, status, id]
    );

    res.json({ 
      message: 'Menu berhasil diupdate',
      foto_url: newFotoUrl
    });
  } catch (error) {
    console.error(error);
    
    // Delete uploaded file if database update fails
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Delete Menu (Admin only)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get menu data untuk hapus foto
    const [menu] = await db.query('SELECT foto_filename FROM menu WHERE id = ?', [id]);
    
    // Delete file if exists
    if (menu[0]?.foto_filename) {
      const filePath = path.join(__dirname, '../uploads/menu', menu[0].foto_filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    
    // Delete from database
    await db.query('DELETE FROM menu WHERE id = ?', [id]);
    
    res.json({ message: 'Menu berhasil dihapus' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

module.exports = router;