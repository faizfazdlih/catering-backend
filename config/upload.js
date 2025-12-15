// config/upload.js
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/menu/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    
    // Determine extension from MIME type (lebih reliable)
    let ext = '.jpg';
    if (file.mimetype === 'image/png') {
      ext = '.png';
    } else if (file.mimetype === 'image/gif') {
      ext = '.gif';
    } else if (file.mimetype === 'image/webp') {
      ext = '.webp';
    }
    
    // Fallback to original extension if exists
    const originalExt = path.extname(file.originalname);
    if (originalExt) {
      ext = originalExt;
    }
    
    cb(null, 'menu-' + uniqueSuffix + ext);
  }
});

// File filter - prioritaskan MIME type
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  
  if (allowedMimeTypes.includes(file.mimetype)) {
    return cb(null, true);
  }
  
  cb(new Error('Hanya file gambar yang diperbolehkan (jpeg, jpg, png, gif, webp)'));
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: fileFilter
});

module.exports = upload;