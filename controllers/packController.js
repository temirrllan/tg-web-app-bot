const packService = require('../services/packService');
const TelegramStarsService = require('../services/telegramStarsService');

const packController = {
  // GET /api/packs - Получить все паки для магазина
  async getStorePacks(req, res) {
    try {
      const packs = await packService.getActiveStorePacks();
      
      res.json({
        success: true,
        packs
      });
    } catch (error) {
      console.error('Get store packs error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load packs'
      });
    }
  },

  // GET /api/packs/:slug - Получить детали пака
  async getPackDetails(req, res) {
    try {
      const { slug } = req.params;
      const userId = req.user?.id;
      
      const pack = await packService.getPackBySlug(slug);
      
      if (!pack) {
        return res.status(404).json({
          success: false,
          error: 'Pack not found'
        });
      }
      
      // Проверяем владение (если пользователь авторизован)
      let owned = false;
      if (userId) {
        const ownershipCheck = await db.query(
          `SELECT id FROM pack_purchases 
           WHERE user_id = $1 AND pack_id = $2 AND status = 'ACTIVE'`,
          [userId, pack.id]
        );
        owned = ownershipCheck.rows.length > 0;
      }
      
      res.json({
        success: true,
        pack: {
          ...pack,
          owned
        }
      });
    } catch (error) {
      console.error('Get pack details error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load pack details'
      });
    }
  },

  // POST /api/packs/:packId/purchase - Купить пак
  async purchasePack(req, res) {
    try {
      const { packId } = req.params;
      const userId = req.user.id;
      
      // Создаём заказ
      const order = await packService.createPackOrder(userId, packId);
      
      // Генерируем invoice для Telegram Stars
      const invoice = await TelegramStarsService.createPackInvoice(
        userId,
        packId,
        order.amount_stars
      );
      
      res.json({
        success: true,
        order_id: order.id,
        invoice_link: invoice.link,
        amount_stars: order.amount_stars
      });
    } catch (error) {
      console.error('Purchase pack error:', error);
      
      if (error.message === 'Pack already purchased') {
        return res.status(400).json({
          success: false,
          error: 'You already own this pack'
        });
      }
      
      res.status(500).json({
        success: false,
        error: 'Failed to initiate purchase'
      });
    }
  },

  // GET /api/packs/:packId/my-details - Получить детали купленного пака
  async getMyPackDetails(req, res) {
    try {
      const { packId } = req.params;
      const userId = req.user.id;
      
      const details = await packService.getPurchasedPackDetails(packId, userId);
      
      if (!details.owned) {
        return res.status(403).json({
          success: false,
          error: 'You do not own this pack'
        });
      }
      
      res.json({
        success: true,
        ...details
      });
    } catch (error) {
      console.error('Get my pack details error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load pack details'
      });
    }
  },

  // GET /api/my-packs - Получить все купленные паки пользователя
  async getMyPacks(req, res) {
    try {
      const userId = req.user.id;
      
      const result = await db.query(
        `SELECT 
          pp.id as purchase_id,
          sp.*,
          pp.granted_at
         FROM pack_purchases pp
         JOIN store_packs sp ON pp.pack_id = sp.id
         WHERE pp.user_id = $1 AND pp.status = 'ACTIVE'
         ORDER BY pp.granted_at DESC`,
        [userId]
      );
      
      res.json({
        success: true,
        packs: result.rows
      });
    } catch (error) {
      console.error('Get my packs error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load your packs'
      });
    }
  }
};

module.exports = packController;