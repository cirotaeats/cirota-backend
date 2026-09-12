const jwt = require('jsonwebtoken');
const env = require('../config/env');
const prisma = require('../config/prisma');

/**
 * Verify Customer JWT Token
 */
async function authenticateCustomer(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing or malformed Authorization header' },
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, env.JWT_SECRET);

    if (decoded.role !== 'CUSTOMER' || !decoded.customerId) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Invalid customer token credentials' },
      });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: decoded.customerId },
      include: { plan: true },
    });

    if (!customer) {
      return res.status(401).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'Customer account not found' },
      });
    }

    req.customer = customer;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'Session expired or invalid token' },
    });
  }
}

/**
 * Verify Admin JWT Token and optionally enforce role
 */
function authenticateAdmin(requiredRoles = []) {
  return async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Admin authentication required' },
        });
      }

      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, env.JWT_SECRET);

      if (!decoded.adminId || !decoded.role) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Invalid admin token' },
        });
      }

      const admin = await prisma.adminUser.findUnique({
        where: { id: decoded.adminId },
      });

      if (!admin) {
        return res.status(401).json({
          success: false,
          error: { code: 'ADMIN_NOT_FOUND', message: 'Admin user not found' },
        });
      }

      // Check role authorization
      if (requiredRoles.length > 0 && !requiredRoles.includes(admin.role)) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'INSUFFICIENT_PERMISSIONS',
            message: `Admin role '${admin.role}' lacks permission for this action. Required: ${requiredRoles.join(', ')}`,
          },
        });
      }

      req.admin = admin;
      next();
    } catch (err) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Admin session expired or invalid token' },
      });
    }
  };
}

/**
 * Verify Delivery Partner JWT Token
 */
async function authenticateDeliveryPartner(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing or malformed Authorization header' },
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, env.JWT_SECRET);

    if (decoded.role !== 'DELIVERY_PARTNER' || !decoded.partnerId) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Invalid delivery partner token credentials' },
      });
    }

    const partner = await prisma.deliveryPartner.findUnique({
      where: { id: decoded.partnerId },
    });

    if (!partner || !partner.is_active) {
      return res.status(401).json({
        success: false,
        error: { code: 'PARTNER_NOT_FOUND', message: 'Delivery partner account not found or deactivated' },
      });
    }

    req.deliveryPartner = partner;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'Session expired or invalid token' },
    });
  }
}

module.exports = {
  authenticateCustomer,
  authenticateAdmin,
  authenticateDeliveryPartner,
};
