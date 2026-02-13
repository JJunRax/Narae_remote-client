import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyCD0Bm2Hvg_c6EaKwq4TWoVOUfQQY45_rM",
    authDomain: "naraesoft-cc2a2.firebaseapp.com",
    projectId: "naraesoft-cc2a2",
    storageBucket: "naraesoft-cc2a2-us",
    messagingSenderId: "364516000980",
    appId: "1:364516000980:web:32aa6865ffbdfdb3966741",
    measurementId: "G-PVG3SE6ZKZ"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
