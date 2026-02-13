// admin/resources/packPurchasesResource.js - Покупки пакетов пользователями

const packPurchasesResource = {
  resource: {
    model: 'pack_purchases',
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
      user_id: {
        type: 'reference',
        reference: 'users',
        isRequired: true
      },
      pack_id: {
        type: 'reference',
        reference: 'store_packs',
        isRequired: true
      },
      order_id: {
        type: 'reference',
        reference: 'pack_orders',
        description: 'Заказ (NULL если бесплатно)'
      },
      source: {
        type: 'string',
        availableValues: [
          { value: 'paid', label: 'Оплачено' },
          { value: 'free', label: 'Бесплатно' },
          { value: 'admin', label: 'Выдано админом' },
          { value: 'promo', label: 'Промо-код' }
        ],
        isRequired: true
      },
      status: {
        type: 'string',
        availableValues: [
          { value: 'ACTIVE', label: 'Активно' },
          { value: 'REFUNDED', label: 'Возврат' },
          { value: 'REVOKED', label: 'Отозвано' }
        ],
        isRequired: true
      },
      granted_at: {
        isVisible: { list: true, filter: false, show: true, edit: false }
      }
    },
    listProperties: ['id', 'user_id', 'pack_id', 'source', 'status', 'granted_at'],
    filterProperties: ['user_id', 'pack_id', 'source', 'status'],
    showProperties: ['id', 'user_id', 'pack_id', 'order_id', 'source', 'status', 'granted_at'],
    editProperties: ['user_id', 'pack_id', 'source', 'status'],
    actions: {
      new: {
        isAccessible: true,
        handler: async (request, response, context) => {
          // Позволяем админу выдавать пакеты вручную
          return {
            record: context.record,
            notice: {
              message: 'Пакет успешно выдан пользователю',
              type: 'success'
            }
          };
        }
      }
    }
  }
};

module.exports = packPurchasesResource;