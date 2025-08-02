const Category = require('../models/Category');

const categoryController = {
  async getAll(req, res) {
    try {
      // Теперь req.user доступен благодаря authMiddleware
      const language = req.user?.language || 'en';
      const categories = await Category.findAll(language);
      
      res.json({
        success: true,
        categories
      });
    } catch (error) {
      console.error('Get categories error:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to load categories' 
      });
    }
  }
};

module.exports = categoryController;