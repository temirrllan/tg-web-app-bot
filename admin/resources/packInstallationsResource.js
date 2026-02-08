// admin/resources/packInstallationsResource.js

const db = require('../../config/database');

module.exports = {
  resource: {
    client: db.pool,
    table: 'pack_installations',
  },
  options: {
    navigation: {
      name: '📦 Pack System',
      icon: 'Download',
    },
    properties: {
      id: {
        isVisible: { list: true, filter: true, show: true, edit: false },
      },
      purchase_id: {
        type: 'reference',
        reference: 'pack_purchases',
        description: 'Purchase',
      },
      status: {
        type: 'string',
        availableValues: [
          { value: 'STARTED', label: 'Started' },
          { value: 'SUCCESS', label: 'Success' },
          { value: 'FAILED', label: 'Failed' },
        ],
      },
      error: {
        type: 'textarea',
        description: 'Error message if failed',
      },
      started_at: {
        isVisible: { list: true, filter: false, show: true, edit: false },
      },
      finished_at: {
        isVisible: { list: true, filter: false, show: true, edit: false },
      },
    },
    listProperties: ['id', 'purchase_id', 'status', 'started_at', 'finished_at'],
    showProperties: [
      'id',
      'purchase_id',
      'status',
      'error',
      'started_at',
      'finished_at',
    ],
    editProperties: [], // Read-only
    filterProperties: ['purchase_id', 'status'],
    sort: {
      sortBy: 'started_at',
      direction: 'desc',
    },
  },
};