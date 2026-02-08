// admin/resources/storePacksResource.js

const db = require('../../config/database');

module.exports = {
  resource: {
    client: db.pool,
    table: 'store_packs',
  },
  options: {
    navigation: {
      name: '📦 Pack System',
      icon: 'Package',
    },
    properties: {
      id: {
        isVisible: { list: true, filter: true, show: true, edit: false },
      },
      slug: {
        isRequired: true,
        type: 'string',
        description: 'URL-friendly identifier (e.g., albert-einstein)',
      },
      cover_image_url: {
        type: 'string',
        description: 'URL to cover image',
        components: {
          edit: 'textarea',
        },
      },
      title: {
        isRequired: true,
        type: 'string',
        description: 'Pack name (e.g., "Альберт Эйнштейн")',
      },
      subtitle: {
        type: 'string',
        description: 'Who is it (e.g., "Учёный")',
      },
      short_description: {
        type: 'textarea',
        description: 'Short description for card',
      },
      long_description: {
        type: 'richtext',
        description: 'Full biography/description',
        components: {
          edit: 'textarea',
        },
      },
      price_stars: {
        isRequired: true,
        type: 'number',
        description: 'Price in Telegram Stars (0 = free)',
        props: {
          min: 0,
        },
      },
      count_habits: {
        isVisible: { list: true, filter: false, show: true, edit: false },
        type: 'number',
        description: 'Auto-calculated from pack_items',
      },
      count_achievements: {
        isVisible: { list: true, filter: false, show: true, edit: false },
        type: 'number',
        description: 'Auto-calculated from achievement levels',
      },
      is_active: {
        type: 'boolean',
        description: 'Show in store?',
      },
      sort_order: {
        type: 'number',
        description: 'Display order in store (lower = first)',
        props: {
          min: 0,
        },
      },
      created_at: {
        isVisible: { list: false, filter: false, show: true, edit: false },
      },
      updated_at: {
        isVisible: { list: false, filter: false, show: true, edit: false },
      },
    },
    listProperties: [
      'id',
      'title',
      'subtitle',
      'price_stars',
      'count_habits',
      'count_achievements',
      'is_active',
      'sort_order',
    ],
    showProperties: [
      'id',
      'slug',
      'cover_image_url',
      'title',
      'subtitle',
      'short_description',
      'long_description',
      'price_stars',
      'count_habits',
      'count_achievements',
      'is_active',
      'sort_order',
      'created_at',
      'updated_at',
    ],
    editProperties: [
      'slug',
      'cover_image_url',
      'title',
      'subtitle',
      'short_description',
      'long_description',
      'price_stars',
      'is_active',
      'sort_order',
    ],
    filterProperties: ['title', 'is_active', 'price_stars'],
    sort: {
      sortBy: 'sort_order',
      direction: 'asc',
    },
  },
};