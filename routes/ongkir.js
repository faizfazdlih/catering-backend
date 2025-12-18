const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../config/database');

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

// Helper to perform calculation (used by POST and GET)
async function performCalculation(params) {
  const { jarak_km, origin, destination } = params;
  const TARIF_PER_KM = 2000;

  if (destination) {
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

    if (!usedOrigin) {
      throw { status: 400, message: 'Origin tidak disertakan dan ORIGIN_LAT/ORIGIN_LNG belum dikonfigurasi di server.' };
    }

    const ORS_KEY = process.env.HEIGIT_API_KEY || process.env.OPENROUTESERVICE_API_KEY;
    if (!ORS_KEY) {
      throw { status: 500, message: 'HEIGIT_API_KEY/OPENROUTESERVICE_API_KEY belum dikonfigurasi. Gunakan jarak_km sebagai fallback.' };
    }

    if (typeof usedOrigin.lat !== 'number' || typeof usedOrigin.lng !== 'number' || typeof destination.lat !== 'number' || typeof destination.lng !== 'number') {
      throw { status: 400, message: 'Format origin/destination tidak valid. Gunakan { lat, lng }.' };
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
      throw { status: 500, message: 'Gagal mendapatkan rute dari heigit/ORS.' };
    }

    const distance_m = segment.distance;
    const duration_s = segment.duration;
    const distance_km = distance_m / 1000;
    const ongkir = Math.ceil(distance_km * TARIF_PER_KM);

    const minutes = Math.round(duration_s / 60);
    const estimasi_waktu = minutes < 60 ? `${minutes} menit` : `${Math.round(minutes / 60)} jam ${minutes % 60} menit`;

    const out = {
      provider: 'heigit_openrouteservice',
      jarak_m: distance_m,
      jarak_km: parseFloat(distance_km.toFixed(3)),
      durasi_s: Math.round(duration_s),
      estimasi_waktu,
      ongkir,
      tarif_per_km: TARIF_PER_KM
    };

    // Save to history (db) - best-effort
    try {
      await saveCalculationToDb({ origin: usedOrigin, destination }, out);
    } catch (e) {
      console.error('Failed to save ongkir history:', e);
    }

    return out;
  }

  if (!jarak_km || jarak_km <= 0) {
    throw { status: 400, message: 'Jarak tidak valid. Kirim { jarak_km } atau { origin, destination }.' };
  }

  const ongkirSimple = Math.ceil(parseFloat(jarak_km) * TARIF_PER_KM);
  const out = {
    provider: 'local_simple',
    jarak_km: parseFloat(jarak_km),
    ongkir: ongkirSimple,
    deskripsi: `Tarif Rp ${TARIF_PER_KM.toLocaleString()} per km (sederhana)`,
    estimasi_waktu: jarak_km < 5 ? '30 menit' : jarak_km < 10 ? '45 menit' : '60 menit'
  };

  // Save local calculation to DB
  try {
    await saveCalculationToDb({ origin: null, destination: null, jarak_km: out.jarak_km }, out);
  } catch (e) {
    console.error('Failed to save ongkir history:', e);
  }

  return out;
}

// Save calculation result into DB (create table if not exists)
async function saveCalculationToDb(input, result, pesananId = null) {
  // ensure table exists
  const createSql = `CREATE TABLE IF NOT EXISTS ongkir_cache (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pesanan_id INT NULL,
    origin_lat DOUBLE NULL,
    origin_lng DOUBLE NULL,
    dest_lat DOUBLE NULL,
    dest_lng DOUBLE NULL,
    jarak_m DOUBLE NULL,
    jarak_km DOUBLE NULL,
    durasi_s DOUBLE NULL,
    ongkir INT NULL,
    provider VARCHAR(100) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;
  await db.query(createSql);

  const origin = input.origin || null;
  const destination = input.destination || null;
  const jarak_km = input.jarak_km || result.jarak_km || null;

  const insertSql = `INSERT INTO ongkir_cache (pesanan_id, origin_lat, origin_lng, dest_lat, dest_lng, jarak_m, jarak_km, durasi_s, ongkir, provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const params = [
    pesananId,
    origin ? origin.lat : null,
    origin ? origin.lng : null,
    destination ? destination.lat : null,
    destination ? destination.lng : null,
    result.jarak_m || null,
    jarak_km,
    result.durasi_s || null,
    result.ongkir || null,
    result.provider || null
  ];

  await db.query(insertSql, params);
}

// POST calculate (existing behavior)
router.post('/calculate', async (req, res) => {
  try {
    const result = await performCalculation(req.body);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ message: err.message || 'Terjadi kesalahan server', details: err.details || null });
  }
});

// Allow GET for easier testing from browser (query params)
// Examples:
// /api/ongkir/calculate?jarak_km=5
// /api/ongkir/calculate?origin=-6.90389,107.61861&destination=-6.91746,107.61912
router.get('/calculate', async (req, res) => {
  try {
    const { jarak_km, origin, destination } = req.query;

    let parsed = {};
    if (jarak_km) parsed.jarak_km = parseFloat(jarak_km);
    if (origin) {
      const [olat, olng] = origin.split(',').map(Number);
      parsed.origin = { lat: olat, lng: olng };
    }
    if (destination) {
      const [dlat, dlng] = destination.split(',').map(Number);
      parsed.destination = { lat: dlat, lng: dlng };
    }

    // If no params provided -> return history
    if (!parsed.jarak_km && !parsed.origin && !parsed.destination) {
      // ensure table exists then fetch last 20 history
      const createSql = `CREATE TABLE IF NOT EXISTS ongkir_cache (
        id INT AUTO_INCREMENT PRIMARY KEY,
        pesanan_id INT NULL,
        origin_lat DOUBLE NULL,
        origin_lng DOUBLE NULL,
        dest_lat DOUBLE NULL,
        dest_lng DOUBLE NULL,
        jarak_m DOUBLE NULL,
        jarak_km DOUBLE NULL,
        durasi_s DOUBLE NULL,
        ongkir INT NULL,
        provider VARCHAR(100) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;
      await db.query(createSql);
      const [rows] = await db.query('SELECT * FROM ongkir_cache ORDER BY created_at DESC LIMIT 20');
      return res.json({ history: rows });
    }

    const result = await performCalculation(parsed);
    // ensure table exists then return result + recent history
    const createSql2 = `CREATE TABLE IF NOT EXISTS ongkir_cache (
      id INT AUTO_INCREMENT PRIMARY KEY,
      pesanan_id INT NULL,
      origin_lat DOUBLE NULL,
      origin_lng DOUBLE NULL,
      dest_lat DOUBLE NULL,
      dest_lng DOUBLE NULL,
      jarak_m DOUBLE NULL,
      jarak_km DOUBLE NULL,
      durasi_s DOUBLE NULL,
      ongkir INT NULL,
      provider VARCHAR(100) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;
    await db.query(createSql2);
    const [rows] = await db.query('SELECT * FROM ongkir_cache ORDER BY created_at DESC LIMIT 10');
    res.json({ result, history: rows });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ message: err.message || 'Terjadi kesalahan server', details: err.details || null });
  }
});

// Explicit heigit endpoint to demonstrate OpenRouteService usage
// POST with JSON { origin: {lat,lng}, destination: {lat,lng} }
router.post('/heigit', async (req, res) => {
  try {
    const ORS_KEY = process.env.HEIGIT_API_KEY || process.env.OPENROUTESERVICE_API_KEY;
    if (!ORS_KEY) {
      return res.status(500).json({ message: 'HEIGIT_API_KEY/OPENROUTESERVICE_API_KEY belum dikonfigurasi di server.' });
    }

    const { origin, destination } = req.body;
    if (!destination) return res.status(400).json({ message: 'Destination dibutuhkan untuk heigit endpoint.' });

    const result = await performCalculation({ origin, destination });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ message: err.message || 'Terjadi kesalahan server', details: err.details || null });
  }
});

// GET heigit for quick browser testing: /api/ongkir/heigit?origin=lat,lng&destination=lat,lng
router.get('/heigit', async (req, res) => {
  try {
    const ORS_KEY = process.env.HEIGIT_API_KEY || process.env.OPENROUTESERVICE_API_KEY;
    if (!ORS_KEY) {
      return res.status(500).json({ message: 'HEIGIT_API_KEY/OPENROUTESERVICE_API_KEY belum dikonfigurasi di server.' });
    }

    const { origin, destination } = req.query;
    if (!destination) return res.status(400).json({ message: 'Destination dibutuhkan untuk heigit endpoint.' });

    const [dlat, dlng] = destination.split(',').map(Number);
    let parsed = { destination: { lat: dlat, lng: dlng } };
    if (origin) {
      const [olat, olng] = origin.split(',').map(Number);
      parsed.origin = { lat: olat, lng: olng };
    }

    const result = await performCalculation(parsed);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ message: err.message || 'Terjadi kesalahan server', details: err.details || null });
  }
});

// RajaOngkir endpoint telah dihapus. Gunakan /calculate dengan provider 'heigit' (OpenRouteService)

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

// Root info for easier debugging (GET /api/ongkir)
router.get('/', (req, res) => {
  res.json({
    message: 'Ongkir routes root',
    endpoints: {
      info: '/api/ongkir/info (GET)',
      calculate: '/api/ongkir/calculate (GET/POST)',
      cities: '/api/ongkir/cities (GET)'
    },
    note: 'Gunakan provider heigit/openrouteservice dengan environment HEIGIT_API_KEY atau OPENROUTESERVICE_API_KEY'
  });
});

module.exports = router;