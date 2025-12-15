const express = require('express');
const router = express.Router();
const axios = require('axios');

// API Info untuk halaman "Tentang"
router.get('/info', (req, res) => {
  res.json({
    api_name: 'Shipping Calculation API',
    description: 'Menghitung jarak & ongkir. Mendukung perhitungan lokal dan OpenRouteService (heigit).',
    providers: {
      local: 'Perhitungan sederhana berdasarkan jarak (km) di server',
      heigit: 'OpenRouteService (heigit) untuk menghitung jarak dan durasi menggunakan routing API'
    },
    note: 'Jika menggunakan heigit, set environment variable HEIGIT_API_KEY atau OPENROUTESERVICE_API_KEY'
  });
});

// Simple calculation based on distance (untuk demo tanpa API key)
// Calculate ongkir. Supports two modes:
// 1) Provide `jarak_km` in body -> simple local calculation
// 2) Provide `origin` and `destination` -> routing via OpenRouteService (heigit) if API key present
router.post('/calculate', async (req, res) => {
  try {
    const { jarak_km, origin, destination } = req.body;

    // Tarif per kilometer (Rupiah)
    const TARIF_PER_KM = 2000;

    // If origin/destination (or at least destination with configured origin) provided, try OpenRouteService (heigit)
    if (destination) {
      // allow using server-configured origin if client only sends destination
      let serverOriginLat = Number(process.env.ORIGIN_LAT);
      let serverOriginLng = Number(process.env.ORIGIN_LNG);
      if (isNaN(serverOriginLat)) serverOriginLat = null;
      if (isNaN(serverOriginLng)) serverOriginLng = null;

      let usedOrigin = origin;
      if (!usedOrigin) {
        if (serverOriginLat !== null && serverOriginLng !== null) {
          usedOrigin = { lat: serverOriginLat, lng: serverOriginLng };
        }
      }

      // debug log to help trace bad requests
      console.debug('ONGKIR calculate body:', { origin, destination, usedOrigin });

      if (!usedOrigin) {
        // if origin still not available, ask client to provide both
        return res.status(400).json({ message: 'Origin tidak disertakan dan ORIGIN_LAT/ORIGIN_LNG belum dikonfigurasi di server.' });
      }
      const ORS_KEY = process.env.HEIGIT_API_KEY || process.env.OPENROUTESERVICE_API_KEY;

      if (!ORS_KEY) {
        return res.status(500).json({ message: 'HEIGIT_API_KEY/OPENROUTESERVICE_API_KEY belum dikonfigurasi. Gunakan body { jarak_km } sebagai fallback.' });
      }

      // Expect usedOrigin and destination as objects: { lat: number, lng: number }
      if (typeof usedOrigin.lat !== 'number' || typeof usedOrigin.lng !== 'number' || typeof destination.lat !== 'number' || typeof destination.lng !== 'number') {
        return res.status(400).json({ message: 'Format origin/destination tidak valid. Gunakan { lat, lng }.' });
      }

      // Build coordinates as [ [lon, lat], [lon, lat] ]
      const coordinates = [
        [usedOrigin.lng, usedOrigin.lat],
        [destination.lng, destination.lat]
      ];

      // Call OpenRouteService directions endpoint
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

      const distance_m = segment.distance; // meters
      const duration_s = segment.duration; // seconds

      const distance_km = distance_m / 1000;
      const ongkir = Math.ceil(distance_km * TARIF_PER_KM);

      // human readable duration
      const minutes = Math.round(duration_s / 60);
      const estimasi_waktu = minutes < 60 ? `${minutes} menit` : `${Math.round(minutes / 60)} jam ${minutes % 60} menit`;

      return res.json({
        provider: 'heigit_openrouteservice',
        jarak_m: distance_m,
        jarak_km: parseFloat(distance_km.toFixed(3)),
        durasi_s: Math.round(duration_s),
        estimasi_waktu,
        ongkir,
        tarif_per_km: TARIF_PER_KM
      });
    }

    // Fallback: simple calculation if jarak_km provided
    if (!jarak_km || jarak_km <= 0) {
      return res.status(400).json({ message: 'Jarak tidak valid. Kirim { jarak_km } atau { origin, destination }.' });
    }

    const ongkirSimple = Math.ceil(parseFloat(jarak_km) * TARIF_PER_KM);

    res.json({
      provider: 'local_simple',
      jarak_km: parseFloat(jarak_km),
      ongkir: ongkirSimple,
      deskripsi: `Tarif Rp ${TARIF_PER_KM.toLocaleString()} per km (sederhana)`,
      estimasi_waktu: jarak_km < 5 ? '30 menit' : jarak_km < 10 ? '45 menit' : '60 menit'
    });
  } catch (error) {
    console.error(error.response?.data || error.message || error);
    res.status(500).json({ message: 'Terjadi kesalahan server', details: error.response?.data || error.message });
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
      // RajaOngkir expects form-urlencoded body
      new URLSearchParams({
        origin: String(origin),
        destination: String(destination),
        weight: String(weight),
        courier: String(courier),
      }).toString(),
      {
        headers: {
          'key': API_KEY,
          'content-type': 'application/x-www-form-urlencoded'
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    // Log more details to help debugging (response body if available)
    const respData = error.response?.data;
    console.error('RajaOngkir error:', respData || error.message);

    // Handle deprecated endpoint (410) specifically and return actionable info
    if (error.response?.status === 410) {
      return res.status(410).json({
        message: 'Endpoint API RajaOngkir sudah tidak aktif. Perlu migrasi ke platform baru dan renewal package.',
        details: respData,
        migrate_url: 'https://collaborator.komerce.id',
        fallback: {
          note: 'Sementara gunakan endpoint perhitungan lokal /api/ongkir/calculate atau cached rates',
          endpoint: '/api/ongkir/calculate'
        }
      });
    }

    res.status(500).json({ message: 'Terjadi kesalahan saat mengakses RajaOngkir API', details: respData || error.message });
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