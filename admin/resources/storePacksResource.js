// admin/resources/storePacksResource.js - Ресурс для управления пакетами в магазине

const { ComponentLoader } = require('adminjs');

const componentLoader = new ComponentLoader();

const storePacksResource = {
  resource: {
    model: 'store_packs',
    client: null // будет установлен в admin/index.js
  },
  options: {
    navigation: {
      name: '📦 Пакеты',
      icon: 'Package'
    },
    properties: {
      id: {
        isVisible: { list: true, filter: true, show: true, edit: false }
      },
      slug: {
        isTitle: true,
        isRequired: true,
        description: 'URL-friendly идентификатор (например: elon-musk-habits)'
      },
      cover_image_url: {
        type: 'string',
        description: 'URL обложки пакета'
      },
      title: {
        isRequired: true,
        description: 'Название пакета (например: "Привычки Илона Маска")'
      },
      subtitle: {
        type: 'textarea',
        description: 'Короткий подзаголовок'
      },
      short_description: {
        type: 'textarea',
        description: 'Краткое описание (1-2 предложения)'
      },
      long_description: {
        type: 'richtext',
        description: 'Полное описание с HTML'
      },
      price_stars: {
        type: 'number',
        isRequired: true,
        description: 'Цена в Telegram Stars (0 = бесплатно)',
        props: {
          min: 0
        }
      },
      count_habits: {
        isVisible: { list: true, filter: false, show: true, edit: false },
        description: 'Автоматический счётчик привычек'
      },
      count_achievements: {
        isVisible: { list: true, filter: false, show: true, edit: false },
        description: 'Автоматический счётчик достижений'
      },
      is_active: {
        type: 'boolean',
        isRequired: true,
        description: 'Показывать в магазине'
      },
      sort_order: {
        type: 'number',
        description: 'Порядок сортировки (меньше = выше)'
      },
      created_at: {
        isVisible: { list: false, filter: false, show: true, edit: false }
      },
      updated_at: {
        isVisible: { list: false, filter: false, show: true, edit: false }
      }
    },
    listProperties: ['id', 'title', 'price_stars', 'count_habits', 'count_achievements', 'is_active', 'sort_order'],
    filterProperties: ['slug', 'title', 'is_active', 'price_stars'],
    showProperties: ['id', 'slug', 'cover_image_url', 'title', 'subtitle', 'short_description', 'long_description', 'price_stars', 'count_habits', 'count_achievements', 'is_active', 'sort_order', 'created_at', 'updated_at'],
    editProperties: ['slug', 'cover_image_url', 'title', 'subtitle', 'short_description', 'long_description', 'price_stars', 'is_active', 'sort_order']
  }
};

module.exports = storePacksResource;