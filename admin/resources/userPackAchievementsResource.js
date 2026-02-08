// admin/resources/userPackAchievementsResource.js

const db = require('../../config/database');

module.exports = {
  resource: {
    client: db.pool,
    table: 'user_pack_achievements',
  },
  options: {
    navigation: {
      name: '📦 Pack System',
      icon: 'Trophy',
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
      level_id: {
        type: 'reference',
        reference: 'pack_achievement_levels',
        description: 'Achievement Level',
      },
      achieved_at: {
        isVisible: { list: true, filter: false, show: true, edit: false },
      },
    },
    listProperties: ['id', 'user_id', 'pack_id', 'level_id', 'achieved_at'],
    editProperties: [], // Read-only
    filterProperties: ['user_id', 'pack_id'],
    sort: {
      sortBy: 'achieved_at',
      direction: 'desc',
    },
  },
};