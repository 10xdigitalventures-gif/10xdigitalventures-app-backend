const { Expo } = require('expo-server-sdk');
const db = require('../db');

const expo = new Expo();

const sendPushNotification = async (userId, title, body, data = {}) => {
  try {
    const [tokens] = await db.query(
      'SELECT token FROM device_tokens WHERE user_id = ?',
      [userId]
    );

    if (tokens.length === 0) return;

    const messages = [];
    for (const { token } of tokens) {
      if (!Expo.isExpoPushToken(token)) {
        console.error(`Push token ${token} is not a valid Expo push token`);
        continue;
      }

      messages.push({
        to: token,
        sound: 'default',
        title,
        body,
        data,
      });
    }

    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        await expo.sendPushNotificationsAsync(chunk);
      } catch (error) {
        console.error('Error sending push chunk:', error);
      }
    }
  } catch (err) {
    console.error('Push notification error:', err);
  }
};

module.exports = { sendPushNotification };
