// admin/resources/packOrdersResource.js

const db = require('../../config/database');

module.exports = {
  resource: {
    client: db.pool,
    table: 'pack_orders',
  },
  options: {
    navigation: {
      name: '📦 Pack System',
      icon: 'CreditCard',
    },
    properties: {
      id: {
        isVisible: { list: true, filter: true, show: true, edit: false },
      },
      user_id: {
        type: 'reference',
        reference: 'users',
        description: 'User',
      },
      pack_id: {
        type: 'reference',
        reference: 'store_packs',
        description: 'Pack',
      },
      amount_stars: {
        type: 'number',
        description: 'Amount in Telegram Stars',
      },
      status: {
        type: 'string',
        availableValues: [
          { value: 'CREATED', label: 'Created' },
          { value: 'PAID', label: 'Paid' },
          { value: 'FAILED', label: 'Failed' },
        ],
      },
      provider: {
        type: 'string',
      },
      provider_invoice_id: {
        type: 'string',
      },
      provider_payment_id: {
        type: 'string',
      },
      created_at: {
        isVisible: { list: true, filter: false, show: true, edit: false },
      },
      paid_at: {
        isVisible: { list: true, filter: false, show: true, edit: false },
      },
    },
    listProperties: [
      'id',
      'user_id',
      'pack_id',
      'amount_stars',
      'status',
      'created_at',
      'paid_at',
    ],
    showProperties: [
      'id',
      'user_id',
      'pack_id',
      'amount_stars',
      'status',
      'provider',
      'provider_invoice_id',
      'provider_payment_id',
      'created_at',
      'paid_at',
    ],
    editProperties: [], // Read-only
    filterProperties: ['user_id', 'pack_id', 'status'],
    sort: {
      sortBy: 'created_at',
      direction: 'desc',
    },
  },
};