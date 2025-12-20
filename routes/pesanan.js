const express = require('express');
const router = express.Router();
const db = require('../config/database');
const axios = require('axios');
const jwt = require('jsonwebtoken');

// Tarif per kilometer (Rupiah)
const TARIF_PER_KM = 2000;

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
      origin,
      destination,
      items, // Array of {menu_id, jumlah, harga_satuan}
      catatan 
    } = req.body;

    // Hitung subtotal paket (harga menu)
    let subtotalPaket = 0;
    (items || []).forEach(item => {
      subtotalPaket += item.jumlah * item.harga_satuan;
    });

    // Hitung ongkir di server (abaikan jika client mengirim ongkir manual)
    let computedOngkir = 0;

    // Jika tersedia destination (dan possible origin), coba gunakan OpenRouteService (heigit)
    if (destination) {
      const serverOriginLat = process.env.ORIGIN_LAT ? parseFloat(process.env.ORIGIN_LAT) : null;
      const serverOriginLng = process.env.ORIGIN_LNG ? parseFloat(process.env.ORIGIN_LNG) : null;

      let usedOrigin = origin;
      if (!usedOrigin) {
        if (serverOriginLat !== null && serverOriginLng !== null) {
          usedOrigin = { lat: serverOriginLat, lng: serverOriginLng };
        }
      }

      if (!usedOrigin) {
        return res.status(400).json({ message: 'Origin tidak disertakan dan ORIGIN_LAT/ORIGIN_LNG belum dikonfigurasi di server.' });
      }

      const ORS_KEY = process.env.HEIGIT_API_KEY || process.env.OPENROUTESERVICE_API_KEY;
      if (!ORS_KEY) {
        return res.status(500).json({ message: 'HEIGIT_API_KEY/OPENROUTESERVICE_API_KEY belum dikonfigurasi. Tidak bisa menghitung jarak otomatis.' });
      }

      if (typeof usedOrigin.lat !== 'number' || typeof usedOrigin.lng !== 'number' || typeof destination.lat !== 'number' || typeof destination.lng !== 'number') {
        return res.status(400).json({ message: 'Format origin/destination tidak valid. Gunakan { lat, lng }.' });
      }

      const coordinates = [
        [usedOrigin.lng, usedOrigin.lat],
        [destination.lng, destination.lat]
      ];

      const orsUrl = 'https://api.openrouteservice.org/v2/directions/driving-car/geojson';
      const orsResp = await axios.post(
        orsUrl,
        { coordinates },
        {
          headers: {
            Authorization: ORS_KEY,
            'Content-Type': 'application/json'
          }
        }
      );

      const feature = orsResp.data?.features?.[0];
      const segment = feature?.properties?.segments?.[0];
      if (!segment) {
        return res.status(500).json({ message: 'Gagal mendapatkan rute dari heigit/ORS.' });
      }

      const distance_m = segment.distance;
      const distance_km = distance_m / 1000;
      computedOngkir = Math.ceil(distance_km * TARIF_PER_KM);

      // set jarak_km supaya disimpan di DB
      req.body.jarak_km = parseFloat(distance_km.toFixed(3));
    } else if (jarak_km && jarak_km > 0) {
      // jika client mengirim jarak_km, gunakan itu untuk menghitung ongkir
      computedOngkir = Math.ceil(parseFloat(jarak_km) * TARIF_PER_KM);
    } else {
      return res.status(400).json({ message: 'Tidak ada data jarak. Sertakan destination (koordinat) atau jarak_km.' });
    }

    // Total akhir = subtotal paket + ongkir
    const total_harga = subtotalPaket + computedOngkir;

    // Insert pesanan
    const [pesananResult] = await connection.query(
      'INSERT INTO pesanan (user_id, tanggal_pesan, waktu_pengiriman, alamat_pengiriman, jarak_km, ongkir, total_harga, catatan) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [user_id, tanggal_pesan, waktu_pengiriman, alamat_pengiriman, req.body.jarak_km || jarak_km || null, computedOngkir, total_harga, catatan]
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

router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatus = ['pending', 'diproses', 'dikirim', 'selesai', 'dibatalkan'];
    if (!validStatus.includes(status)) {
      return res.status(400).json({ message: 'Status tidak valid' });
    }

   
    const [currentPesanan] = await db.query('SELECT status, user_id FROM pesanan WHERE id = ?', [id]);
    
    if (currentPesanan.length === 0) {
      return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
    }
    const currentStatus = currentPesanan[0].status;
    const ownerId = currentPesanan[0].user_id;

    // Jika client mencoba mengubah status menjadi 'selesai', pastikan token valid dan pemilik pesanan
    if (status === 'selesai') {
      const authHeader = req.headers.authorization || req.headers.Authorization;
      if (!authHeader) {
        return res.status(401).json({ message: 'Autentikasi dibutuhkan untuk mengubah status menjadi selesai' });
      }

      const parts = authHeader.split(' ');
      const token = parts.length === 2 && parts[0].toLowerCase() === 'bearer' ? parts[1] : authHeader;
      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch (err) {
        return res.status(401).json({ message: 'Token tidak valid' });
      }

      // Hanya client pemilik pesanan yang boleh mengubah menjadi selesai
      if (decoded.role !== 'client' || decoded.userId !== ownerId) {
        return res.status(403).json({ message: 'Hanya client pemilik pesanan yang dapat mengkonfirmasi penerimaan (mengubah status menjadi selesai).' });
      }
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

// Get Chart Data (Admin) - Today, Weekly, Monthly
router.get('/admin/chart-data', async (req, res) => {
  try {
    const { period } = req.query; // 'today', 'weekly', 'monthly'

    let chartData = [];

    if (period === 'today') {
      // Data per jam hari ini
      const [results] = await db.query(`
        SELECT 
          HOUR(created_at) as label,
          COUNT(*) as orders,
          COALESCE(SUM(total_harga), 0) as revenue
        FROM pesanan
        WHERE DATE(created_at) = CURDATE()
        GROUP BY HOUR(created_at)
        ORDER BY label
      `);
      
      // Fill missing hours with 0
      const hourlyData = Array(24).fill(null).map((_, i) => ({
        label: i.toString(),
        orders: 0,
        revenue: 0
      }));
      
      results.forEach(row => {
        hourlyData[row.label] = {
          label: row.label.toString(),
          orders: row.orders,
          revenue: parseFloat(row.revenue) || 0
        };
      });
      
      chartData = hourlyData;

    } else if (period === 'weekly') {
      // Data 7 hari terakhir - simplified approach
      const [results] = await db.query(`
        SELECT 
          DATE(created_at) as order_date,
          COUNT(*) as orders,
          COALESCE(SUM(total_harga), 0) as revenue
        FROM pesanan
        WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
        GROUP BY DATE(created_at)
        ORDER BY order_date
      `);
      
      // Create date map for results
      const dataMap = {};
      results.forEach(row => {
        // Convert date to simple string format YYYY-MM-DD
        const dateObj = new Date(row.order_date);
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        
        dataMap[dateStr] = {
          orders: row.orders,
          revenue: parseFloat(row.revenue) || 0
        };
      });
      
      // Fill in all 7 days
      const weekData = [];
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const today = new Date();
      
      for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);
        
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        const dayName = dayNames[date.getDay()];
        
        weekData.push({
          label: dayName,
          orders: dataMap[dateStr] ? dataMap[dateStr].orders : 0,
          revenue: dataMap[dateStr] ? dataMap[dateStr].revenue : 0
        });
      }
      
      chartData = weekData;

    } else if (period === 'monthly') {
      // Data 4 minggu terakhir (group by week)
      const [results] = await db.query(`
        SELECT 
          FLOOR(DATEDIFF(CURDATE(), DATE(created_at)) / 7) as week_offset,
          COUNT(*) as orders,
          COALESCE(SUM(total_harga), 0) as revenue
        FROM pesanan
        WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 28 DAY)
        GROUP BY week_offset
        ORDER BY week_offset DESC
      `);
      
      // Create week map
      const weekMap = {};
      results.forEach(row => {
        weekMap[row.week_offset] = {
          orders: row.orders,
          revenue: parseFloat(row.revenue) || 0
        };
      });
      
      // Generate 4 weeks data
      const monthData = [];
      for (let i = 3; i >= 0; i--) {
        const weekNum = 4 - i;
        if (weekMap[i]) {
          monthData.push({
            label: `Week ${weekNum}`,
            orders: weekMap[i].orders,
            revenue: weekMap[i].revenue
          });
        } else {
          monthData.push({
            label: `Week ${weekNum}`,
            orders: 0,
            revenue: 0
          });
        }
      }
      
      chartData = monthData;
    } else {
      return res.status(400).json({ message: 'Invalid period. Use: today, weekly, or monthly' });
    }

    res.json({ chartData });
  } catch (error) {
    console.error('Chart Data Error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ message: 'Terjadi kesalahan server', error: error.message });
  }
});

module.exports = router;