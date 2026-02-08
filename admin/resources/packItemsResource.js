// admin/resources/packItemsResource.js

const db = require('../../config/database');

module.exports = {
  resource: {
    client: db.pool,
    table: 'pack_items',
  },
  options: {
    navigation: {
      name: '📦 Pack System',
      icon: 'List',
    },
    properties: {
      id: {
        isVisible: { list: true, filter: true, show: true, edit: false },
      },
      pack_id: {
        isRequired: true,
        type: 'reference',
        reference: 'store_packs',
        description: 'Select pack',
      },
      template_id: {
        isRequired: true,
        type: 'reference',
        reference: 'pack_habit_templates',
        description: 'Select habit template',
      },
      sort_order: {
        type: 'number',
        description: 'Order in pack (lower = first)',
      },
      created_at: {
        isVisible: { list: false, filter: false, show: true, edit: false },
      },
    },
    listProperties: ['id', 'pack_id', 'template_id', 'sort_order'],
    editProperties: ['pack_id', 'template_id', 'sort_order'],
    sort: {
      sortBy: 'pack_id',
      direction: 'asc',
    },
  },
};