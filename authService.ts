import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  collection, 
  getDocs 
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { UserRole } from '../types/chat';

export interface UserProfile {
  userId: string;
  username: string;
  displayName: string;
  avatar: string;
  color: string;
  role: UserRole;
  createdAt: number;
}

export interface RegisterPayload {
  username: string;
  password: string;
  displayName: string;
  avatar: string;
  color: string;
  requestedRole?: UserRole;
}

export interface LoginPayload {
  username: string;
  password: string;
}

// Default bootstrap admin usernames (e.g. app owner / admin)
const BOOTSTRAP_ADMIN_USERNAMES = ['admin', 'mena', 'menamohamed', 'khalifa'];

/**
 * SHA-256 hashing using Web Crypto API
 */
export async function hashPassword(password: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(password + '_chathub_salt_2026');
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Extract / verify role strictly from Firebase Firestore
 */
export async function extractRoleFromFirebase(username: string): Promise<UserRole> {
  const cleanUsername = username.trim().toLowerCase();
  try {
    // 1. Check dedicated /admins collection in Firestore
    const adminDocRef = doc(db, 'admins', cleanUsername);
    const adminSnap = await getDoc(adminDocRef);
    if (adminSnap.exists()) {
      return (adminSnap.data().role as UserRole) || 'admin';
    }

    // 2. Check /users collection in Firestore
    const userDocRef = doc(db, 'users', cleanUsername);
    const userSnap = await getDoc(userDocRef);
    if (userSnap.exists()) {
      const data = userSnap.data();
      if (data.role === 'admin' || data.role === 'moderator') {
        return data.role;
      }
    }

    // 3. Check bootstrap whitelist
    if (BOOTSTRAP_ADMIN_USERNAMES.includes(cleanUsername)) {
      // Auto-provision this user as admin in Firebase
      await setDoc(adminDocRef, {
        username: cleanUsername,
        role: 'admin',
        assignedAt: Date.now(),
        assignedBy: 'system_bootstrap',
      }, { merge: true });
      return 'admin';
    }

    return 'user';
  } catch (e) {
    console.warn('Error extracting role from Firebase:', e);
    return 'user';
  }
}

/**
 * Register a new user account in Firestore
 */
export async function registerUser(payload: RegisterPayload): Promise<UserProfile> {
  const cleanUsername = payload.username.trim().toLowerCase();
  if (!cleanUsername || cleanUsername.length < 3) {
    throw new Error('اسم المستخدم يجب أن يتكون من 3 أحرف على الأقل');
  }
  if (!/^[a-zA-Z0-9_\u0600-\u06FF]+$/.test(cleanUsername)) {
    throw new Error('اسم المستخدم يمكن أن يحتوي على أحرف وأرقام وشرطة سفلية فقط');
  }
  if (!payload.password || payload.password.length < 4) {
    throw new Error('كلمة المرور يجب أن تكون 4 خانات على الأقل');
  }

  const userDocRef = doc(db, 'users', cleanUsername);

  try {
    const existingSnap = await getDoc(userDocRef);
    if (existingSnap.exists()) {
      throw new Error('اسم المستخدم محجوز بالفعل! يرجى اختيار اسم مستخدم آخر أو تسجيل الدخول.');
    }

    // Determine initial role from Firebase admins or bootstrap
    let role: UserRole = 'user';
    if (BOOTSTRAP_ADMIN_USERNAMES.includes(cleanUsername)) {
      role = 'admin';
      // Register in /admins collection too
      await setDoc(doc(db, 'admins', cleanUsername), {
        username: cleanUsername,
        role: 'admin',
        assignedAt: Date.now(),
        assignedBy: 'bootstrap',
      });
    }

    const passwordHash = await hashPassword(payload.password);
    const userId = `uid-${cleanUsername}-${Date.now()}`;
    const displayName = (payload.displayName || payload.username).trim();

    const userData = {
      userId,
      username: cleanUsername,
      displayName,
      avatar: payload.avatar || '😎',
      color: payload.color || '#3b82f6',
      role,
      passwordHash,
      createdAt: Date.now(),
    };

    await setDoc(userDocRef, userData);

    return {
      userId,
      username: cleanUsername,
      displayName,
      avatar: userData.avatar,
      color: userData.color,
      role,
      createdAt: userData.createdAt,
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('محجوز')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `users/${cleanUsername}`);
    throw err;
  }
}

/**
 * Login user with username and password, extracting role from Firebase
 */
export async function loginUser(payload: LoginPayload): Promise<UserProfile> {
  const cleanUsername = payload.username.trim().toLowerCase();
  if (!cleanUsername) {
    throw new Error('يرجى كتابة اسم المستخدم');
  }
  if (!payload.password) {
    throw new Error('يرجى كتابة كلمة المرور');
  }

  const userDocRef = doc(db, 'users', cleanUsername);

  try {
    const docSnap = await getDoc(userDocRef);
    if (!docSnap.exists()) {
      // Check if user entered an admin bootstrap account that hasn't been created yet
      if (BOOTSTRAP_ADMIN_USERNAMES.includes(cleanUsername)) {
        // Register it on the fly as an admin!
        return await registerUser({
          username: cleanUsername,
          password: payload.password,
          displayName: cleanUsername === 'admin' ? 'المدير العام (الأدمن)' : cleanUsername,
          avatar: '👑',
          color: '#ef4444',
          requestedRole: 'admin',
        });
      }
      throw new Error('اسم المستخدم غير مسجل، يرجى إنشاء حساب أولاً');
    }

    const data = docSnap.data();
    const inputHash = await hashPassword(payload.password);

    if (data.passwordHash !== inputHash) {
      throw new Error('كلمة المرور غير صحيحة، يرجى المحاولة مرة أخرى');
    }

    // Extract true role from Firebase (checks /admins and /users)
    const verifiedRole = await extractRoleFromFirebase(cleanUsername);

    // If role changed in Firebase, sync user doc
    if (data.role !== verifiedRole) {
      await updateDoc(userDocRef, { role: verifiedRole }).catch(() => {});
    }

    return {
      userId: data.userId || `uid-${cleanUsername}`,
      username: data.username,
      displayName: data.displayName || data.username,
      avatar: data.avatar || '😎',
      color: data.color || '#3b82f6',
      role: verifiedRole,
      createdAt: data.createdAt || Date.now(),
    };
  } catch (err: unknown) {
    if (err instanceof Error && (err.message.includes('غير مسجل') || err.message.includes('غير صحيحة'))) {
      throw err;
    }
    handleFirestoreError(err, OperationType.GET, `users/${cleanUsername}`);
    throw err;
  }
}

/**
 * Get all users from Firestore (For Admin Panel)
 */
export async function getAllUsersFromFirebase(): Promise<UserProfile[]> {
  try {
    const usersCol = collection(db, 'users');
    const snapshot = await getDocs(usersCol);
    const users: UserProfile[] = [];
    snapshot.forEach((d) => {
      const data = d.data();
      users.push({
        userId: data.userId || d.id,
        username: data.username || d.id,
        displayName: data.displayName || data.username || d.id,
        avatar: data.avatar || '😊',
        color: data.color || '#3b82f6',
        role: (data.role as UserRole) || 'user',
        createdAt: data.createdAt || Date.now(),
      });
    });
    return users;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'users');
    return [];
  }
}

/**
 * Update a user's role in Firebase Firestore (Admin action)
 */
export async function updateUserRoleInFirebase(
  targetUsername: string, 
  newRole: UserRole, 
  adminUsername: string
): Promise<void> {
  const cleanTarget = targetUsername.trim().toLowerCase();
  const userRef = doc(db, 'users', cleanTarget);
  const adminRef = doc(db, 'admins', cleanTarget);

  try {
    await updateDoc(userRef, { role: newRole });

    if (newRole === 'admin' || newRole === 'moderator') {
      await setDoc(adminRef, {
        username: cleanTarget,
        role: newRole,
        assignedAt: Date.now(),
        assignedBy: adminUsername,
      });
    } else {
      // If demoted to regular user, remove from /admins
      await setDoc(adminRef, {
        username: cleanTarget,
        role: 'user',
        assignedAt: Date.now(),
        assignedBy: adminUsername,
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${cleanTarget}`);
  }
}
