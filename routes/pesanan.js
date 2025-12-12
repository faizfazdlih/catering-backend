const express = require('express');
const router = express.Router();
const db = require('../config/database');

// Create Pesanan
router.post('/', async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();

    const { 
      user_id, 
      tanggal_pesan, 
      waktu_pengiriman,
      alamat_pengiriman, 
      jarak_km,
      ongkir,
      items, // Array of {menu_id, jumlah, harga_satuan}
      catatan 
    } = req.body;

    // Calculate total
    let total_harga = parseFloat(ongkir) || 0;
    items.forEach(item => {
      total_harga += item.jumlah * item.harga_satuan;
    });

    // Insert pesanan
    const [pesananResult] = await connection.query(
      'INSERT INTO pesanan (user_id, tanggal_pesan, waktu_pengiriman, alamat_pengiriman, jarak_km, ongkir, total_harga, catatan) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [user_id, tanggal_pesan, waktu_pengiriman, alamat_pengiriman, jarak_km, ongkir, total_harga, catatan]
    );

    const pesanan_id = pesananResult.insertId;

    // Insert detail pesanan
    for (const item of items) {
      const subtotal = item.jumlah * item.harga_satuan;
      await connection.query(
        'INSERT INTO detail_pesanan (pesanan_id, menu_id, jumlah, harga_satuan, subtotal) VALUES (?, ?, ?, ?, ?)',
        [pesanan_id, item.menu_id, item.jumlah, item.harga_satuan, subtotal]
      );
    }

    await connection.commit();

    res.status(201).json({ 
      message: 'Pesanan berhasil dibuat',
      pesanan_id,
      total_harga
    });
  } catch (error) {
    await connection.rollback();
    console.error(error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  } finally {
    connection.release();
  }
});

// Get Pesanan by User
router.get('/user/:user_id', async (req, res) => {
  try {
    const { user_id } = req.params;
    
    const [pesanan] = await db.query(
      `SELECT p.*, 
        (SELECT COUNT(*) FROM detail_pesanan WHERE pesanan_id = p.id) as jumlah_item
       FROM pesanan p 
       WHERE p.user_id = ? 
       ORDER BY p.created_at DESC`,
      [user_id]
    );

    res.json({ pesanan });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get Pesanan Detail
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [pesanan] = await db.query(
      `SELECT p.*, u.nama as nama_customer, u.email, u.no_telepon
       FROM pesanan p
       LEFT JOIN users u ON p.user_id = u.id
       WHERE p.id = ?`,
      [id]
    );

    if (pesanan.length === 0) {
      return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
    }

    const [detail] = await db.query(
      `SELECT dp.*, m.nama_menu, m.kategori
       FROM detail_pesanan dp
       LEFT JOIN menu m ON dp.menu_id = m.id
       WHERE dp.pesanan_id = ?`,
      [id]
    );

    res.json({ 
      pesanan: pesanan[0],
      detail 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get All Pesanan (Admin)
router.get('/', async (req, res) => {
  try {
    const [pesanan] = await db.query(
      `SELECT p.*, u.nama as nama_customer, u.no_telepon,
        (SELECT COUNT(*) FROM detail_pesanan WHERE pesanan_id = p.id) as jumlah_item
       FROM pesanan p
       LEFT JOIN users u ON p.user_id = u.id
       ORDER BY p.created_at DESC`
    );

    res.json({ pesanan });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Update Pesanan Status (Admin)
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatus = ['pending', 'diproses', 'dikirim', 'selesai', 'dibatalkan'];
    if (!validStatus.includes(status)) {
      return res.status(400).json({ message: 'Status tidak valid' });
    }

    await db.query('UPDATE pesanan SET status = ? WHERE id = ?', [status, id]);
    
    res.json({ message: `Status pesanan berhasil diubah menjadi ${status}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Get Statistics (Admin)
router.get('/admin/statistics', async (req, res) => {
  try {
    const [totalPesanan] = await db.query('SELECT COUNT(*) as total FROM pesanan');
    const [pendingPesanan] = await db.query('SELECT COUNT(*) as total FROM pesanan WHERE status = ?', ['pending']);
    const [totalPendapatan] = await db.query('SELECT SUM(total_harga) as total FROM pesanan WHERE status IN (?, ?)', ['selesai', 'dikirim']);
    const [pesananHariIni] = await db.query('SELECT COUNT(*) as total FROM pesanan WHERE DATE(created_at) = CURDATE()');

    res.json({
      total_pesanan: totalPesanan[0].total,
      pesanan_pending: pendingPesanan[0].total,
      total_pendapatan: totalPendapatan[0].total || 0,
      pesanan_hari_ini: pesananHariIni[0].total
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

module.exports = router;