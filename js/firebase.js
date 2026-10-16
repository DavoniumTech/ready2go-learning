import { firebaseConfig } from "./firebase-config.js";

// Firebase modules are imported only when the learner opens account features.
// This keeps the question practice shell usable offline after it has been cached.
let firebasePromise;
async function getFirebase() {
  if (!navigator.onLine) throw new Error("An internet connection is needed for account sign-in. You can still practise offline.");
  if (!firebasePromise) {
    firebasePromise = (async () => {
      const version = "13.0.0";
      const appSdk = await import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`);
      const authSdk = await import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`);
      const functionsSdk = await import(`https://www.gstatic.com/firebasejs/${version}/firebase-functions.js`);
      const app = appSdk.initializeApp(firebaseConfig);
      const auth = authSdk.getAuth(app);
      const functions = functionsSdk.getFunctions(app, "us-central1");
      return { app, auth, functions, ...authSdk, ...functionsSdk };
    })().catch((error) => { firebasePromise = undefined; throw error; });
  }
  return firebasePromise;
}

export async function registerWithEmail({ name, email, password }) {
  const sdk = await getFirebase();
  const credential = await sdk.createUserWithEmailAndPassword(sdk.auth, email, password);
  await sdk.updateProfile(credential.user, { displayName: name.trim() });
  return credential.user;
}
export async function signInWithEmail({ email, password }) {
  const sdk = await getFirebase();
  const credential = await sdk.signInWithEmailAndPassword(sdk.auth, email, password);
  return credential.user;
}
export async function signInWithGoogle() {
  const sdk = await getFirebase();
  const provider = new sdk.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  // Firebase recommends redirect sign-in on mobile browsers; popup is convenient on desktop.
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) {
    await sdk.signInWithRedirect(sdk.auth, provider);
    return null; // Browser is redirected to Google's sign-in page.
  }

  const credential = await sdk.signInWithPopup(sdk.auth, provider);
  return credential.user;
}
export async function updateUserDisplayName(name) {
  const sdk = await getFirebase();
  if (!sdk.auth.currentUser) throw new Error("Please sign in before changing your account name.");
  await sdk.updateProfile(sdk.auth.currentUser, { displayName: name.trim() });
  return sdk.auth.currentUser;
}
export async function signOutUser() {
  const sdk = await getFirebase();
  await sdk.signOut(sdk.auth);
}
export async function sendResetEmail(email) {
  const sdk = await getFirebase();
  await sdk.sendPasswordResetEmail(sdk.auth, email);
}
export async function watchAuthState(callback) {
  try {
    const sdk = await getFirebase();
    try {
      await sdk.getRedirectResult(sdk.auth);
    } catch (redirectError) {
      callback(null, redirectError);
    }
    return sdk.onAuthStateChanged(sdk.auth, callback);
  } catch (error) {
    callback(null, error);
    return null;
  }
}
export function friendlyAuthError(error) {
  const messages = {
    "auth/email-already-in-use": "That email already has an account. Try signing in instead.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/weak-password": "Choose a stronger password (at least 6 characters).",
    "auth/invalid-credential": "The email or password is incorrect.",
    "auth/user-disabled": "This account has been disabled. Contact support.",
    "auth/too-many-requests": "Too many attempts. Please wait and try again.",
    "auth/network-request-failed": "Connection failed. Check the internet and try again.",
    "auth/unauthorized-domain": "This domain is not authorised in Firebase yet. Add localhost for local testing or the Ready2Go domain before production."
  };
  return messages[error?.code] || error?.message || "Something went wrong. Please try again.";
}

// Cloud sync is optional until the Firebase Functions package has been deployed.
// Local-first practice still works when this endpoint is unavailable.
async function callReady2GoFunction(name, data) {
  const sdk = await getFirebase();
  const callable = sdk.httpsCallable(sdk.functions, name);
  const result = await callable(data);
  return result.data;
}
export async function saveLearnerProfileRemote(profile) {
  return callReady2GoFunction("saveLearnerProfile", { profile });
}
export async function recordPracticeSummaryRemote(summary) {
  return callReady2GoFunction("recordPracticeSummary", { summary });
}
export async function attributeTeacherReferralRemote(code) {
  return callReady2GoFunction("attributeTeacherReferral", { code });
}
