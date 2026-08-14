const express = require('express');
const router = express.Router();
const controller = require('../controllers/feriadosController');

router.get('/', controller.getAll);
router.post('/', controller.create);
router.put('/:fecha', controller.update);
router.delete('/:fecha', controller.remove);

module.exports = router;
