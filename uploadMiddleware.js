const multer = require('multer');

// Configure multer to store files in a temporary location
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

module.exports = upload;