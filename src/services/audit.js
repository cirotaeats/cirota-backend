const prisma = require('../config/prisma');
const logger = require('../utils/logger');

/**
 * Record an audit log entry for sensitive entity state changes
 */
async function logAuditEvent({ entityType, entityId, action, previousState, newState, metadata, db = prisma }) {
  try {
    return await db.auditLog.create({
      data: {
        entity_type: entityType,
        entity_id: entityId,
        action,
        previous_state: previousState ? JSON.stringify(previousState) : null,
        new_state: newState ? JSON.stringify(newState) : null,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });
  } catch (error) {
    logger.error('Failed to write audit log:', error);
    // Do not throw to avoid blocking the main transaction unless required
  }
}

module.exports = {
  logAuditEvent,
};
