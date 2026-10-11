const WebSocket = require('ws');
const { getDatabase } = require('./database');
const { canAccessConversation, sameBranchId } = require('./chatService');
const { consumeChatSocketTicket } = require('./chatRoutes');

function send(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function attachChatRealtime(server, { getDb = getDatabase } = {}) {
  const websocketServer = new WebSocket.Server({ noServer: true, maxPayload: 8192 });
  const clientsByUser = new Map();

  server.on('upgrade', (request, socket, head) => {
    let pathname;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== '/api/chat/socket') return;
    websocketServer.handleUpgrade(request, socket, head, client => {
      websocketServer.emit('connection', client, request);
    });
  });

  websocketServer.on('connection', client => {
    let authenticated = false;
    let user;
    const authTimeout = setTimeout(() => {
      if (!authenticated) client.close(1008, 'Authentication required');
    }, 5000);

    client.on('message', async raw => {
      let event;
      try {
        event = JSON.parse(String(raw));
      } catch {
        client.close(1003, 'Invalid event');
        return;
      }

      if (!authenticated) {
        if (event?.type !== 'authenticate' || typeof event.ticket !== 'string') {
          client.close(1008, 'Authentication required');
          return;
        }
        try {
          user = await consumeChatSocketTicket(getDb(), event.ticket);
        } catch {
          user = null;
        }
        if (!user) {
          client.close(1008, 'Session expired');
          return;
        }
        authenticated = true;
        clearTimeout(authTimeout);
        const sockets = clientsByUser.get(user.id) || new Set();
        sockets.add(client);
        clientsByUser.set(user.id, sockets);
        client.user = user;
        send(client, { type: 'ready' });
        return;
      }

      // Clients may not subscribe to arbitrary conversation identifiers. All
      // data events originate from an authorized, persisted HTTP operation.
      if (event?.type === 'ping') send(client, { type: 'pong' });
      else client.close(1008, 'Unsupported event');
    });

    client.on('close', () => {
      clearTimeout(authTimeout);
      if (!user) return;
      const sockets = clientsByUser.get(user.id);
      sockets?.delete(client);
      if (sockets?.size === 0) clientsByUser.delete(user.id);
    });
    client.on('error', () => {});
  });

  const heartbeat = setInterval(() => {
    websocketServer.clients.forEach(client => {
      if (client.isAlive === false) {
        client.terminate();
        return;
      }
      client.isAlive = false;
      client.ping();
    });
  }, 30_000);
  heartbeat.unref?.();
  websocketServer.on('connection', client => {
    client.isAlive = true;
    client.on('pong', () => {
      client.isAlive = true;
    });
  });

  async function recipientsFor(conversation) {
    if (!conversation?.id) return [];
    const db = getDb();
    const assignedTeacher = await db.collection('users').findOne({
      id: String(conversation.teacherUserId),
      role: 'teacher',
      active: { $ne: false },
    });
    if (typeof assignedTeacher?.branchId !== 'string' || !assignedTeacher.branchId.trim())
      return [];
    const teacherAccess = await canAccessConversation(
      db,
      {
        id: String(assignedTeacher.id),
        role: 'teacher',
        branchId: String(assignedTeacher.branchId),
      },
      conversation,
    );
    if (!teacherAccess) return [];
    const student = teacherAccess.student;
    const recipients = new Set([String(conversation.teacherUserId)]);
    if (student.userId) recipients.add(String(student.userId));
    const links = await db
      .collection('parentChildLinks')
      .find({
        studentId: String(student.id),
        revokedAt: null,
        status: { $ne: 'revoked' },
        $or: [{ status: 'verified' }, { verified: true }],
      })
      .toArray();
    const participantIds = [
      ...links.map(link => ({ id: String(link.parentUserId || ''), role: 'parent' })),
      ...(student.userId ? [{ id: String(student.userId), role: 'student' }] : []),
      { id: String(conversation.teacherUserId), role: 'teacher' },
    ].filter(participant => participant.id);
    const participants = await Promise.all(
      participantIds.map(participant =>
        db.collection('users').findOne({
          id: participant.id,
          role: participant.role,
          active: { $ne: false },
        }),
      ),
    );
    participants.forEach(participant => {
      if (participant && sameBranchId(participant.branchId, student.branchId)) {
        recipients.add(String(participant.id));
      }
    });
    return [...recipients];
  }

  async function publish(event, conversation) {
    const recipients = await recipientsFor(conversation);
    recipients.forEach(userId => {
      clientsByUser.get(userId)?.forEach(client => send(client, event));
    });
  }

  server.once('close', () => {
    clearInterval(heartbeat);
    websocketServer.clients.forEach(client => client.close(1001, 'Server closing'));
    websocketServer.close();
  });

  return { publish, websocketServer };
}

module.exports = { attachChatRealtime };
