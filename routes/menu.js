const express = require('express');
const router = express.Router();
const db = require('../config/database');

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

// Add Menu (Admin only)
router.post('/', async (req, res) => {
  try {
    const { nama_menu, deskripsi, harga, kategori, foto_url } = req.body;

    const [result] = await db.query(
      'INSERT INTO menu (nama_menu, deskripsi, harga, kategori, foto_url) VALUES (?, ?, ?, ?, ?)',
      [nama_menu, deskripsi, harga, kategori, foto_url]
    );

    res.status(201).json({ 
      message: 'Menu berhasil ditambahkan',
      menuId: result.insertId 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Update Menu (Admin only)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nama_menu, deskripsi, harga, kategori, foto_url, status } = req.body;

    await db.query(
      'UPDATE menu SET nama_menu = ?, deskripsi = ?, harga = ?, kategori = ?, foto_url = ?, status = ? WHERE id = ?',
      [nama_menu, deskripsi, harga, kategori, foto_url, status, id]
    );

    res.json({ message: 'Menu berhasil diupdate' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Delete Menu (Admin only)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM menu WHERE id = ?', [id]);
    res.json({ message: 'Menu berhasil dihapus' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

module.exports = router;