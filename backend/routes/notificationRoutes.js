const Notification = require("../models/Notification");
const Motoboy = require("../models/Motoboy");
const Store = require("../models/Store");
const Order = require("../models/Order");
const express = require("express");
const router = express.Router();
const motoboyServices = require("../services/motoboyServices");
const pushNotificationService = require("../services/pushNotificationService");
const notificationService = require("../services/notificationService");
const fullScreenNotificationService = require("../services/fullScreenNotificationService");

const getNotifications = async (req, res) => {
  try {
    const motoboyId = req.query.motoboyId; // Modificado de req.params para req.query
    const notifications = await Notification.find({
      motoboyId: motoboyId,
      status: "PENDING",
      type: "DELIVERY_REQUEST",
    });
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getNotificationsAll = async (req, res) => {
  try {
    const motoboyId = req.query.motoboyId; // Modificado de req.params para req.query
    const notifications = await Notification.find({
      motoboyId: motoboyId,
    });
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const createNotification = async (req, res) => {
  try {
    const { motoboyId, order, fullscreen } = req.body;

    const motoboy = await Motoboy.findById(motoboyId);
    if (!motoboy) {
      throw new Error("Motoboy não encontrado");
    }

    const notification =
      await notificationService.createDeliveryRequestNotification({
        motoboyId,
        order,
        fullscreen,
      });

    // Enviar evento SSE se disponível na aplicação
    if (req.app.locals.sendEventToStore) {
      try {
        const notifyData = {
          notificationId: notification._id,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          data: notification.data,
        };

        const notified = req.app.locals.sendEventToStore(
          motoboy.firebaseUid,
          "notificationUpdate",
          notification
        );

        console.log(
          `Notificação SSE ${notified ? "ENVIADA" : "FALHOU"} para motoboy ${
            motoboy.name
          }`
        );
      } catch (notifyError) {
        console.error("Erro ao enviar notificação SSE:", notifyError);
      }
    }

    res.status(201).json(notification);
  } catch (error) {
    console.error("Erro ao criar notificação:", error);
    res.status(500).json({ message: error.message });
  }
};

const orderReadyNotification = async (req, res) => {
  try {
    const { motoboyId, orderId } = req.body;
    if (!motoboyId || !orderId) {
      return res.status(400).json({
        message: "Dados incompletos. motoboyId e orderId são obrigatórios",
      });
    }
    const motoboy = await Motoboy.findById(motoboyId);
    if (!motoboy) {
      return res.status(404).json({ message: "Motoboy não encontrado" });
    }
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Pedido não encontrado" });
    }
    const notification = new Notification({
      motoboyId: motoboy._id,
      type: "ORDER_READY",
      title: "Pedido Pronto",
      message: `O pedido ${order.orderNumber} está pronto para retirada no estabelecimento ${order.store.name}.`,
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60000 * 60 * 1 * 1), // 1 hora para expirar
    });
    await notification.save();
    // Enviar notificação push
    let fcmNotification = null;
    if (motoboy.fcmToken) {
      try {
        fcmNotification =
          await pushNotificationService.sendCallStyleNotificationFCM(
            motoboy.fcmToken,
            notification.title,
            notification.message,
            {
              notificationId: notification._id,
              type: notification.type,
              screen: "/(tabs)",
              orderId: order._id,
            }
          );
      } catch (pushError) {
        console.error("Erro ao enviar notificação push:", pushError);
        // Não falhar o request se a notificação push falhar
      }
    }
    res.status(201).json({
      message: "Notificação de pedido pronto criada com sucesso",
      notification,
      fcmNotification,
    });
  } catch (error) {
    console.error("Erro ao criar notificação de pedido pronto:", error);
    res.status(500).json({ message: error.message });
  }
};

const updateNotification = async (req, res) => {
  try {
    const { id, status } = req.body;
    if (!id || !status) {
      return res.status(400).json({
        message: "Dados incompletos. id e status são obrigatórios",
      });
    }
    const notification = await Notification.findById(id);
    const motoboy = await Motoboy.findById(notification.motoboyId);
    notification.status = status;
    await notification.save();

    req.app.locals.sendEventToStore(
      motoboy.firebaseUid,
      "notificationUpdateBell",
      notification.status !== "READ"
    );

    res.status(200).json({ message: "Atualizado com sucesso", notification });
  } catch (error) {
    res.status(500).json({ message: "Erro interno", error });
  }
};

const createNotificationGeneric = async (req, res) => {
  try {
    const {
      motoboyId,
      title,
      message,
      type,
      expiresAt,
      firebaseUid,
      screen,
      chatId,
    } = req.body;
    // Verificar se motoboy existe e está disponível
    let motoboy = await Motoboy.findById(motoboyId);
    if (!motoboy) {
      motoboy = await Motoboy.findOne({ firebaseUid: firebaseUid });
    }
    // console.log(motoboy._id)

    // Criar a notificação
    const notification = new Notification({
      motoboyId: motoboy ? motoboy._id : null,
      type: type || "SYSTEM",
      title: title,
      message: message,
      status: "PENDING",
      expiresAt: expiresAt || new Date(Date.now() + 60000 * 60 * 24 * 7), // 360 dias para expirar
    });
    await notification.save();

    if (!motoboy || motoboy.pushToken || motoboy.pushToken === null) {
      try {
        await pushNotificationService.sendPushNotification(
          motoboy.pushToken,
          notification.title,
          notification.message,
          {
            notificationId: notification._id,
            type: notification.type,
            screen: screen || "notifications",
          }
        );
      } catch (pushError) {
        console.error("Erro ao enviar notificação push:", pushError);
        // Não falhar o request se a notificação push falhar
      }
    }

    if (req.app.locals.sendEventToStore) {
      try {
        const notifyData = {
          notificationId: notification._id,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          chatId: chatId || null,
        };

        req.app.locals.sendEventToStore(
          firebaseUid,
          notification.type || "genericNotification",
          notifyData
        );
      } catch (notifyError) {
        console.error(`Erro ao enviar notificação SSE para:`, notifyError);
      }
    }

    res.status(201).json(notification);
  } catch (error) {
    console.error("Erro ao criar notificação:", error);
    res.status(500).json({ message: error.message });
  }
};

const notifySupport = async (req, res) => {
  try {
    const { title, message, data } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        message: "Dados incompletos. title e message são obrigatórios",
      });
    }

    // Buscar todos os membros ativos da equipe de suporte
    const SupportTeam = require("../models/SupportTeam");
    const supportMembers = await SupportTeam.find({ active: true });

    if (supportMembers.length === 0) {
      return res
        .status(404)
        .json({ message: "Nenhum membro de suporte ativo encontrado" });
    }

    const notifications = [];
    const notificationPromises = [];

    // Criar uma notificação para cada membro do suporte
    for (const supportMember of supportMembers) {
      const notification = new Notification({
        firebaseUid: supportMember.firebaseUid, // Armazenar ID do membro do suporte
        type: "SUPPORT_ALERT",
        title: title,
        message: message,
        data: data || {},
        status: "PENDING",
        expiresAt: new Date(Date.now() + 60000 * 60 * 24 * 7), // 7 dias para expirar
      });

      notifications.push(notification);
      notificationPromises.push(notification.save());

      // Enviar evento SSE para este membro específico do suporte
      if (req.app.locals.sendEventToStore) {
        try {
          const notifyData = {
            notificationId: notification._id,
            type: notification.type,
            title: notification.title,
            message: notification.message,
            data: notification.data,
          };

          // Enviar notificação para o UID do Firebase deste membro do suporte
          req.app.locals.sendEventToStore(
            supportMember.firebaseUid,
            "supportNotification",
            notifyData
          );

          console.log(
            `Notificação enviada para o membro de suporte: ${supportMember.name} (${supportMember.firebaseUid})`
          );
        } catch (notifyError) {
          console.error(
            `Erro ao enviar notificação SSE para ${supportMember.name}:`,
            notifyError
          );
        }
      }
    }

    // Aguardar todas as notificações serem salvas
    await Promise.all(notificationPromises);

    res.status(201).json({
      message: `Notificações enviadas para ${notifications.length} membros do suporte`,
      notifications: notifications,
    });
  } catch (error) {
    console.error("Erro ao criar notificações para suporte:", error);
    res.status(500).json({ message: error.message });
  }
};

const notifyOccurrence = async (req, res) => {
  try {
    const { title, message, firebaseUid } = req.body;
    console.log("notifyOccurrence", req.body);

    if (!title || !message) {
      return res.status(400).json({
        message:
          "Dados incompletos. motoboyId, orderId, title e message são obrigatórios",
      });
    }

    const notification = new Notification({
      firebaseUid: firebaseUid, // Armazenar ID do membro do suporte
      type: "MOTOBOY",
      title: title,
      message: message,
      data: { title, message },
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60000 * 60 * 24 * 7), // 7 dias para expirar
    });

    await notification.save();

    // Enviar evento SSE para o motoboy
    if (req.app.locals.sendEventToStore) {
      try {
        const notifyData = {
          notificationId: notification._id,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          data: notification.data,
        };

        req.app.locals.sendEventToStore(
          firebaseUid,
          "occurrenceNotification",
          notifyData
        );
      } catch (notifyError) {
        console.error("Erro ao enviar notificação SSE:", notifyError);
      }
    }

    let user;
    user = await Motoboy.findOne({ firebaseUid: firebaseUid });
    if (!user) {
      user = await Store.findOne({ firebaseUid: firebaseUid });
    }
    if (!user) {
      return res.status(404).json({ message: "Usuario não encontrado" });
    }

    if (user.pushToken) {
      try {
        await pushNotificationService.sendPushNotification(
          user.pushToken,
          notification.title,
          notification.message,
          {
            notificationId: notification._id,
            type: notification.type,
            orderId: user._id,
            screen: "/occurrences",
          }
        );
      } catch (pushError) {
        console.error("Erro ao enviar notificação push:", pushError);
        // Não falhar o request se a notificação push falhar
      }
    }
    res.status(201).json(notification);
  } catch (error) {
    console.error("Erro ao criar notificação:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * Cria uma notificação estilo chamada do WhatsApp (full screen intent)
 */
const createCallStyleNotification = async (req, res) => {
  try {
    const {
      motoboyId,
      firebaseUid,
      title,
      message,
      type,
      timeoutSeconds,
      callId,
      screen,
      additionalData,
    } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        message: "Dados incompletos. title e message são obrigatórios",
      });
    }

    const result = await notificationService.createCallStyleNotification(
      {
        motoboyId,
        firebaseUid,
        title,
        message,
        type,
        timeoutSeconds,
        callId,
        screen,
        additionalData,
      },
      req.app
    );

    console.log(
      `Notificação estilo chamada criada com sucesso: ${result.callId}`
    );
    res.status(201).json(result);
  } catch (error) {
    console.error("Erro ao criar notificação estilo chamada:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * Responde a uma notificação estilo chamada (aceitar/recusar)
 */
const respondToCallStyleNotification = async (req, res) => {
  try {
    const { callId, action, firebaseUid } = req.body;

    if (!callId || !action || !firebaseUid) {
      return res.status(400).json({
        message:
          "Dados incompletos. callId, action e firebaseUid são obrigatórios",
      });
    }

    if (!["accept", "decline"].includes(action)) {
      return res.status(400).json({
        message: "Ação inválida. Use 'accept' ou 'decline'",
      });
    }

    const result = await notificationService.respondToCallStyleNotification(
      { callId, action, firebaseUid },
      req.app
    );

    console.log(`Resposta da chamada processada: ${callId} - ${action}`);
    res.json(result);
  } catch (error) {
    console.error("Erro ao responder notificação estilo chamada:", error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * Busca informações de uma chamada pelo ID
 */
const getCallInfo = async (req, res) => {
  try {
    const { callId } = req.params;

    if (!callId) {
      return res.status(400).json({
        message: "callId é obrigatório",
      });
    }

    const notification = await Notification.findOne({
      "data.callId": callId,
      type: "CALL_STYLE",
    });

    if (!notification) {
      return res.status(404).json({
        message: "Chamada não encontrada",
      });
    }

    res.json({
      callId,
      notification,
      status: notification.status,
      createdAt: notification.createdAt,
      expiresAt: notification.expiresAt,
      data: notification.data,
    });
  } catch (error) {
    console.error("Erro ao buscar informações da chamada:", error);
    res.status(500).json({ message: error.message });
  }
};

router.post("/notifyOccurrence", notifyOccurrence);
router.post("/notifySupport", notifySupport);
router.post("/generic", createNotificationGeneric);
router.get("/", getNotifications);
router.get("/all", getNotificationsAll);
router.post("/", createNotification);
router.put("/", updateNotification);
router.post("/call-style", createCallStyleNotification);
router.post("/call-style/respond", respondToCallStyleNotification);
router.get("/call-style/:callId", getCallInfo);
router.post("/order-ready", orderReadyNotification);

module.exports = router;
