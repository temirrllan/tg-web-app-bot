// admin/resources/packAchievementLevelsResource.js

const db = require('../../config/database');

module.exports = {
  resource: {
    client: db.pool,
    table: 'pack_achievement_levels',
  },
  options: {
    navigation: {
      name: '📦 Pack System',
      icon: 'Award',
    },
    properties: {
      id: {
        isVisible: { list: true, filter: true, show: true, edit: false },
      },
      pack_id: {
        isRequired: true,
        type: 'reference',
        reference: 'store_packs',
        description: 'Pack',
      },
      title: {
        isRequired: true,
        type: 'string',
        description: 'Level name (e.g., "Новичок", "Опытный")',
      },
      description: {
        type: 'textarea',
        description: 'Level description',
      },
      required_completions: {
        isRequired: true,
        type: 'number',
        description: 'How many completed habits required',
        props: {
          min: 1,
        },
      },
      sort_order: {
        type: 'number',
        description: 'Display order (lower = first)',
      },
      is_active: {
        type: 'boolean',
      },
      created_at: {
        isVisible: { list: false, filter: false, show: true, edit: false },
      },
    },
    listProperties: [
      'id',
      'pack_id',
      'title',
      'required_completions',
      'sort_order',
      'is_active',
    ],
    editProperties: [
      'pack_id',
      'title',
      'description',
      'required_completions',
      'sort_order',
      'is_active',
    ],
    filterProperties: ['pack_id', 'is_active'],
    sort: {
      sortBy: 'sort_order',
      direction: 'asc',
    },
  },
};