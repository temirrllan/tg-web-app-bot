// admin/resources/packPurchasesResource.js

const db = require('../../config/database');

module.exports = {
  resource: {
    client: db.pool,
    table: 'pack_purchases',
  },
  options: {
    navigation: {
      name: '📦 Pack System',
      icon: 'ShoppingCart',
    },
    properties: {
      id: {
        isVisible: { list: true, filter: true, show: true, edit: false },
      },
      user_id: {
        isRequired: true,
        type: 'reference',
        reference: 'users',
        description: 'User',
      },
      pack_id: {
        isRequired: true,
        type: 'reference',
        reference: 'store_packs',
        description: 'Pack',
      },
      order_id: {
        type: 'reference',
        reference: 'pack_orders',
        description: 'Related order (NULL for free)',
      },
      source: {
        isRequired: true,
        type: 'string',
        availableValues: [
          { value: 'paid', label: 'Paid' },
          { value: 'free', label: 'Free' },
          { value: 'admin', label: 'Admin Grant' },
          { value: 'promo', label: 'Promo' },
        ],
      },
      status: {
        type: 'string',
        availableValues: [
          { value: 'ACTIVE', label: 'Active' },
          { value: 'REFUNDED', label: 'Refunded' },
        ],
      },
      granted_at: {
        isVisible: { list: true, filter: false, show: true, edit: false },
      },
    },
    listProperties: [
      'id',
      'user_id',
      'pack_id',
      'source',
      'status',
      'granted_at',
    ],
    showProperties: [
      'id',
      'user_id',
      'pack_id',
      'order_id',
      'source',
      'status',
      'granted_at',
    ],
    editProperties: ['user_id', 'pack_id', 'order_id', 'source', 'status'],
    filterProperties: ['user_id', 'pack_id', 'source', 'status'],
    sort: {
      sortBy: 'granted_at',
      direction: 'desc',
    },
    actions: {
      // Добавим custom action для бесплатной выдачи
      grantFreePack: {
        actionType: 'record',
        component: false,
        handler: async (request, response, context) => {
          const { record, currentAdmin } = context;
          
          // Логика выдачи будет в следующем шаге
          return {
            record: record.toJSON(currentAdmin),
            notice: {
              message: 'Pack granted successfully',
              type: 'success',
            },
          };
        },
      },
    },
  },
};