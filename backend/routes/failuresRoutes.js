const express = require('express');
const router = express.Router();
const controller = require('../controllers/failuresController');

router.get('/machines', controller.getMachinesByArea); // ?area=DTF
router.get('/titles', controller.searchFailureTitles); // ?q=texto
router.post('/titles', controller.createFailureType); 
router.post('/', controller.createTicket);
router.get('/', controller.getAllTickets); // GET /api/failures
router.get('/history', controller.getHistory); // ?area=DTF

module.exports = router;

