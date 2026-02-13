// admin/resources/packAchievementLevelsResource.js - Уровни достижений для пакетов

const packAchievementLevelsResource = {
  resource: {
    model: 'pack_achievement_levels',
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
      title: {
        isTitle: true,
        isRequired: true,
        description: 'Название достижения'
      },
      description: {
        type: 'textarea',
        description: 'Описание достижения'
      },
      required_completions: {
        type: 'number',
        isRequired: true,
        description: 'Сколько выполнений нужно',
        props: {
          min: 1
        }
      },
      sort_order: {
        type: 'number',
        description: 'Порядок (меньше = раньше получается)'
      },
      is_active: {
        type: 'boolean',
        isRequired: true,
        description: 'Активно'
      },
      created_at: {
        isVisible: { list: false, filter: false, show: true, edit: false }
      }
    },
    listProperties: ['id', 'pack_id', 'title', 'required_completions', 'is_active', 'sort_order'],
    filterProperties: ['pack_id', 'is_active'],
    showProperties: ['id', 'pack_id', 'title', 'description', 'required_completions', 'sort_order', 'is_active', 'created_at'],
    editProperties: ['pack_id', 'title', 'description', 'required_completions', 'sort_order', 'is_active']
  }
};

module.exports = packAchievementLevelsResource;