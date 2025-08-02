

const logger = (req, res, next) => {
  console.log(`\n📥 ${new Date().toISOString()} - ${req.method} ${req.path}`);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('Body:', JSON.stringify(req.body, null, 2));
  }
  
  // Сохраняем оригинальные методы
  const originalSend = res.send;
  const originalJson = res.json;
  
  // Перехватываем ответ
  res.json = function(data) {
    console.log(`📤 Response [${res.statusCode}]:`, JSON.stringify(data, null, 2));
    originalJson.call(this, data);
  };
  
  res.send = function(data) {
    console.log(`📤 Response [${res.statusCode}]:`, data);
    originalSend.call(this, data);
  };
  
  next();
};

module.exports = logger;