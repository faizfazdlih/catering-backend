const express = require('express');
const router = express.Router();
const axios = require('axios');

// API Info untuk halaman "Tentang"
router.get('/info', (req, res) => {
  res.json({
    api_name: 'RajaOngkir API',
    description: 'API untuk mengecek ongkos kirim berbagai ekspedisi di Indonesia',
    website: 'https://rajaongkir.com',
    usage: 'Digunakan untuk menghitung biaya pengiriman catering berdasarkan jarak'
  });
});

// Simple calculation based on distance (untuk demo tanpa API key)
router.post('/calculate', async (req, res) => {
  try {
    const { jarak_km } = req.body;
    
    if (!jarak_km || jarak_km <= 0) {
      return res.status(400).json({ message: 'Jarak tidak valid' });
    }

    // Tarif: Rp 5000 untuk 5km pertama, lalu Rp 2000/km
    let ongkir = 5000;
    if (jarak_km > 5) {
      ongkir += (jarak_km - 5) * 2000;
    }

    res.json({
      jarak_km: parseFloat(jarak_km),
      ongkir: Math.round(ongkir),
      deskripsi: `Tarif Rp 5.000 untuk 5km pertama, kemudian Rp 2.000/km`,
      estimasi_waktu: jarak_km < 5 ? '30 menit' : jarak_km < 10 ? '45 menit' : '60 menit'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

// Contoh integrasi dengan RajaOngkir (memerlukan API key)
router.post('/rajaongkir', async (req, res) => {
  try {
    const { origin, destination, weight, courier } = req.body;
    const API_KEY = process.env.RAJAONGKIR_API_KEY;

    if (!API_KEY) {
      return res.status(500).json({ 
        message: 'API Key RajaOngkir belum dikonfigurasi. Gunakan /calculate untuk perhitungan sederhana.' 
      });
    }

    const response = await axios.post(
      'https://api.rajaongkir.com/starter/cost',
      {
        origin,
        destination,
        weight,
        courier
      },
      {
        headers: {
          'key': API_KEY,
          'content-type': 'application/x-www-form-urlencoded'
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Terjadi kesalahan saat mengakses RajaOngkir API' });
  }
});

// Get City List (untuk autocomplete)
router.get('/cities', async (req, res) => {
  try {
    // Daftar kota sample untuk demo
    const cities = [
      { id: 1, name: 'Bandung', province: 'Jawa Barat' },
      { id: 2, name: 'Jakarta', province: 'DKI Jakarta' },
      { id: 3, name: 'Surabaya', province: 'Jawa Timur' },
      { id: 4, name: 'Cimahi', province: 'Jawa Barat' },
      { id: 5, name: 'Bekasi', province: 'Jawa Barat' }
    ];

    res.json({ cities });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

module.exports = router;