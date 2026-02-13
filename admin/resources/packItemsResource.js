// admin/resources/packItemsResource.js - Привязка шаблонов к пакетам

const packItemsResource = {
  resource: {
    model: 'pack_items',
    client: null
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
      pack_id: {
        type: 'reference',
        reference: 'store_packs',
        isRequired: true,
        description: 'Пакет'
      },
      template_id: {
        type: 'reference',
        reference: 'pack_habit_templates',
        isRequired: true,
        description: 'Шаблон привычки'
      },
      sort_order: {
        type: 'number',
        description: 'Порядок в пакете (меньше = выше)'
      }
    },
    listProperties: ['id', 'pack_id', 'template_id', 'sort_order'],
    filterProperties: ['pack_id', 'template_id'],
    showProperties: ['id', 'pack_id', 'template_id', 'sort_order'],
    editProperties: ['pack_id', 'template_id', 'sort_order']
  }
};

module.exports = packItemsResource;