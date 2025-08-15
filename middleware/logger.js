const logger = (req, res, next) => {
  console.log(`\n📥 ${new Date().toISOString()} - ${req.method} ${req.path}`);
  try {
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
  } catch {}

  if (req.body && Object.keys(req.body).length > 0) {
    try {
      console.log('Body:', JSON.stringify(req.body, null, 2));
    } catch {}
  }

  const originalSend = res.send.bind(res);
  const originalJson = res.json.bind(res);

  res.json = function (data) {
    try {
      console.log(`📤 Response [${res.statusCode}]:`, JSON.stringify(data, null, 2));
    } catch {}
    return originalJson(data);
  };

  res.send = function (data) {
    try {
      console.log(`📤 Response [${res.statusCode}]:`, data);
    } catch {}
    return originalSend(data);
  };

  next();
};

module.exports = logger;
