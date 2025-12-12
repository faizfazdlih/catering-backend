require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
const authRoutes = require('./routes/auth');
const menuRoutes = require('./routes/menu');
const pesananRoutes = require('./routes/pesanan');
const ongkirRoutes = require('./routes/ongkir');

app.use('/api/auth', authRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/pesanan', pesananRoutes);
app.use('/api/ongkir', ongkirRoutes);

// Default route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Catering API Server',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      menu: '/api/menu',
      pesanan: '/api/pesanan',
      ongkir: '/api/ongkir'
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`http://localhost:${PORT}`);
});