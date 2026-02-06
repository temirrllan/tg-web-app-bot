const AdminJS = require('adminjs');
const AdminJSExpress = require('@adminjs/express');
const db = require('../config/database');

// Конфигурация ресурсов для управления
const adminOptions = {
  resources: [
    {
      resource: 'store_packs',
      options: {
        properties: {
          id: { isVisible: { list: true, filter: true, show: true, edit: false } },
          slug: { isRequired: true },
          title: { isRequired: true },
          cover_image_url: { type: 'string' },
          short_description: { type: 'textarea' },
          long_description: { type: 'richtext' },
          author_name: { isRequired: true },
          author_bio: { type: 'textarea' },
          price_stars: { type: 'number', isRequired: true },
          is_active: { type: 'boolean' },
          sort_order: { type: 'number' }
        },
        actions: {
          new: {},
          edit: {},
          delete: {},
          list: {},
          show: {}
        }
      }
    },
    {
      resource: 'habit_templates',
      options: {
        properties: {
          title_private: { isRequired: true },
          goal: { type: 'textarea' },
          category_id: { type: 'reference', reference: 'categories' },
          schedule_type: { 
            availableValues: [
              { value: 'daily', label: 'Daily' },
              { value: 'weekdays', label: 'Weekdays' },
              { value: 'custom', label: 'Custom' }
            ]
          },
          is_active: { type: 'boolean' }
        }
      }
    },
    {
      resource: 'pack_items',
      options: {
        properties: {
          pack_id: { type: 'reference', reference: 'store_packs', isRequired: true },
          template_id: { type: 'reference', reference: 'habit_templates', isRequired: true },
          sort_order: { type: 'number' }
        }
      }
    }
  ],
  rootPath: '/admin',
  branding: {
    companyName: 'Habit Tracker Admin',
    logo: false
  }
};

// Создание админки
const adminJs = new AdminJS(adminOptions);

// Защита админки
const adminRouter = AdminJSExpress.buildAuthenticatedRouter(adminJs, {
  authenticate: async (telegram_id, password) => {
    // Проверяем в таблице admin_users
    const result = await db.query(
      'SELECT * FROM admin_users WHERE telegram_id = $1 AND is_active = true',
      [telegram_id]
    );
    
    return result.rows.length > 0 ? result.rows[0] : null;
  },
  cookiePassword: process.env.ADMIN_COOKIE_SECRET || 'some-secret-password'
});

module.exports = { adminRouter };