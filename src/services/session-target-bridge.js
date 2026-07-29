'use strict';

/**
 * SessionTargetBridge — traduce entre los DOS espacios de sesión CDP.
 *
 * El overlay y chrome-devtools-mcp abren conexiones CDP independientes contra
 * el mismo navegador. Cada conexión recibe su PROPIO sessionId para una misma
 * pestaña, así que un sessionId de un lado no significa nada en el otro. El
 * único identificador compartido y estable es el `targetId` del navegador.
 *
 * Esta clase mantiene los índices y resuelve la traducción:
 *
 *     sessionId_cliente ──(targetId)──▶ sessionId_overlay
 *
 * para que un click que la IA manda por SU sesión se dibuje SOLO en la
 * sesión-overlay de esa misma pestaña, en vez de en todas (broadcast).
 *
 * Encapsula todo el estado: los servicios solo la alimentan (métodos link… /
 * unlink…) y consultan (resolveOverlaySession). No expone los Map directamente.
 */
class SessionTargetBridge {
  constructor() {
    /** @type {Map<string,string>} sessionId_cliente → targetId */
    this._clientToTarget = new Map();
    /** @type {Map<string,string>} targetId → sessionId_overlay */
    this._targetToOverlay = new Map();
    /** @type {Map<string,string>} sessionId_overlay → targetId (para olvidar) */
    this._overlayToTarget = new Map();
  }

  /** Aprende el vínculo del lado cliente (lo alimenta el tap del proxy). */
  linkClient(sessionId, targetId) {
    if (!sessionId || !targetId) return;
    this._clientToTarget.set(sessionId, targetId);
  }

  /** El cliente soltó una pestaña (Target.detachedFromTarget). */
  unlinkClient(sessionId) {
    if (sessionId) this._clientToTarget.delete(sessionId);
  }

  /** Aprende el vínculo del lado overlay (su propia conexión CDP). */
  linkOverlay(sessionId, targetId) {
    if (!sessionId || !targetId) return;
    this._targetToOverlay.set(targetId, sessionId);
    this._overlayToTarget.set(sessionId, targetId);
  }

  /** El overlay soltó una sesión. Borra el índice inverso sin pisar re-attaches. */
  unlinkOverlay(sessionId) {
    const targetId = this._overlayToTarget.get(sessionId);
    if (targetId === undefined) return;
    this._overlayToTarget.delete(sessionId);
    // Solo limpiar targetId→overlay si aún apunta a ESTA sesión (no a un re-attach).
    if (this._targetToOverlay.get(targetId) === sessionId) {
      this._targetToOverlay.delete(targetId);
    }
  }

  /**
   * Resuelve la sesión-overlay directamente por targetId global. Lo usan los
   * tools custom, cuyo túnel /devtools/page/<targetId> da el targetId sin pasar
   * por un sessionId de cliente.
   * @param {string} targetId
   * @returns {string|null} sessionId_overlay, o null si no hay vínculo.
   */
  resolveOverlayByTarget(targetId) {
    if (!targetId) return null;
    const overlaySession = this._targetToOverlay.get(targetId);
    return overlaySession === undefined ? null : overlaySession;
  }

  /**
   * Resuelve la sesión-overlay que corresponde a un sessionId del cliente.
   * @param {string} clientSessionId
   * @returns {string|null} sessionId_overlay, o null si no hay vínculo conocido.
   */
  resolveOverlaySession(clientSessionId) {
    if (!clientSessionId) return null;
    const targetId = this._clientToTarget.get(clientSessionId);
    if (targetId === undefined) return null;
    const overlaySession = this._targetToOverlay.get(targetId);
    return overlaySession === undefined ? null : overlaySession;
  }

  /**
   * Olvida SOLO el lado overlay (al caer/reconectar su WS). El lado cliente lo
   * mantiene el proxy, que es una conexión independiente y sigue viva.
   */
  clearOverlay() {
    this._targetToOverlay.clear();
    this._overlayToTarget.clear();
  }

  /** Vacía ambos lados. */
  clear() {
    this._clientToTarget.clear();
    this._targetToOverlay.clear();
    this._overlayToTarget.clear();
  }
}

module.exports = { SessionTargetBridge };
