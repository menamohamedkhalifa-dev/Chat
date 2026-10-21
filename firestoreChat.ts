import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { ChatMessage, User } from '../types/chat';

const MESSAGES_COLLECTION = 'messages';
const PRESENCE_COLLECTION = 'presence';

/**
 * Real-time listener for messages in a specific room
 */
export function subscribeToRoomMessages(
  room: string,
  onMessages: (messages: ChatMessage[]) => void,
  onError?: (err: unknown) => void
) {
  const q = query(
    collection(db, MESSAGES_COLLECTION),
    where('room', '==', room),
    orderBy('timestamp', 'asc'),
    limit(200)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const messages: ChatMessage[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        messages.push({
          id: docSnap.id,
          senderId: data.senderId,
          senderName: data.senderName,
          senderAvatar: data.senderAvatar || '😊',
          senderColor: data.senderColor || '#3b82f6',
          senderRole: data.senderRole,
          text: data.text,
          room: data.room,
          timestamp: data.timestamp || Date.now(),
          isPinned: data.isPinned || false,
          replyTo: data.replyTo,
          reactions: data.reactions || {},
          isSystem: data.isSystem || false,
        });
      });
      onMessages(messages);
    },
    (error) => {
      console.error('Error fetching room messages:', error);
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, `${MESSAGES_COLLECTION}?room=${room}`);
    }
  );
}

/**
 * Save a new chat message to Firestore
 */
export async function saveMessageToFirestore(message: ChatMessage): Promise<void> {
  const docRef = doc(db, MESSAGES_COLLECTION, message.id);
  try {
    const payload: Record<string, unknown> = {
      id: message.id,
      senderId: message.senderId,
      senderName: message.senderName,
      senderAvatar: message.senderAvatar,
      senderColor: message.senderColor,
      senderRole: message.senderRole || 'user',
      text: message.text,
      room: message.room,
      timestamp: message.timestamp,
      isPinned: message.isPinned || false,
      isSystem: message.isSystem || false,
      reactions: message.reactions || {},
    };
    if (message.replyTo) {
      payload.replyTo = message.replyTo;
    }
    await setDoc(docRef, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `${MESSAGES_COLLECTION}/${message.id}`);
  }
}

/**
 * Delete a message from Firestore (Admin / Author action)
 */
export async function deleteMessageFromFirestore(messageId: string): Promise<void> {
  const docRef = doc(db, MESSAGES_COLLECTION, messageId);
  try {
    await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${MESSAGES_COLLECTION}/${messageId}`);
  }
}

/**
 * Toggle pin status of a message in Firestore (Admin action)
 */
export async function togglePinMessageInFirestore(messageId: string, isPinned: boolean): Promise<void> {
  const docRef = doc(db, MESSAGES_COLLECTION, messageId);
  try {
    await updateDoc(docRef, { isPinned });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${MESSAGES_COLLECTION}/${messageId}`);
  }
}

/**
 * Clear all messages in a room (Admin action)
 */
export async function clearRoomMessagesInFirestore(room: string): Promise<void> {
  try {
    const q = query(collection(db, MESSAGES_COLLECTION), where('room', '==', room));
    const snapshot = await getDocs(q);
    const deletePromises = snapshot.docs.map((d) => deleteDoc(d.ref));
    await Promise.all(deletePromises);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${MESSAGES_COLLECTION}?room=${room}`);
  }
}

/**
 * Update reactions for a message in Firestore
 */
export async function updateReactionsInFirestore(
  messageId: string,
  reactions: Record<string, string[]>
): Promise<void> {
  const docRef = doc(db, MESSAGES_COLLECTION, messageId);
  try {
    await updateDoc(docRef, { reactions });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${MESSAGES_COLLECTION}/${messageId}`);
  }
}

/**
 * Update user presence in Firestore
 */
export async function setUserPresenceInFirestore(user: {
  userId: string;
  username: string;
  role?: string;
  avatar: string;
  color: string;
  room: string;
}): Promise<void> {
  const docRef = doc(db, PRESENCE_COLLECTION, user.userId);
  try {
    await setDoc(docRef, {
      userId: user.userId,
      username: user.username,
      role: user.role || 'user',
      avatar: user.avatar,
      color: user.color,
      room: user.room,
      lastSeen: Date.now(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${PRESENCE_COLLECTION}/${user.userId}`);
  }
}

/**
 * Remove user presence when disconnecting
 */
export async function removeUserPresenceFromFirestore(userId: string): Promise<void> {
  const docRef = doc(db, PRESENCE_COLLECTION, userId);
  try {
    await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${PRESENCE_COLLECTION}/${userId}`);
  }
}

/**
 * Real-time listener for active users in a room
 */
export function subscribeToRoomPresence(
  room: string,
  onUsers: (users: User[]) => void
) {
  const q = query(collection(db, PRESENCE_COLLECTION), where('room', '==', room));

  return onSnapshot(
    q,
    (snapshot) => {
      const now = Date.now();
      const activeUsers: User[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (now - (data.lastSeen || 0) < 120000) {
          activeUsers.push({
            socketId: docSnap.id,
            userId: data.userId || docSnap.id,
            username: data.username || 'صديق',
            role: data.role || 'user',
            avatar: data.avatar || '😊',
            color: data.color || '#3b82f6',
            room: data.room || room,
            joinedAt: data.lastSeen || now,
          });
        }
      });
      onUsers(activeUsers);
    },
    (error) => {
      console.warn('Presence listener error:', error);
    }
  );
}
