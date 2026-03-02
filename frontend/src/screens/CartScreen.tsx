import { useMemo, useState } from "react";
import { createOrder } from "../api/orders";
import type { ToastTone } from "../hooks/useToast";
import type { CartItem } from "../types";
import MapPicker from "../ui/MapPicker";
import TopHeader from "../ui/TopHeader";
import { appendGeoTag, isValidLatLng, type LatLng } from "../utils/geo";
import { logger } from "../utils/logger";

type DeliveryMode = "YANDEX" | "SUPPLIER_COURIER" | "BUYER_COURIER";

export default function CartScreen({
  active,
  items,
  total,
  onInc,
  onDec,
  onRemove,
  onClear,
  cartCount,
  onBurger,
  onCheckoutSuccess,
  buyerCompanyId,
  onNotify,
}: {
  active: boolean;
  items: CartItem[];
  total: number;
  onInc: (productId: string) => void;
  onDec: (productId: string) => void;
  onRemove: (productId: string) => void;
  onClear: () => void;
  cartCount: number;
  onBurger: () => void;
  onCheckoutSuccess: () => void;
  buyerCompanyId?: number | null;
  onNotify: (message: string, tone?: ToastTone) => void;
}) {
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [address, setAddress] = useState("\u0423\u043b\u0438\u0446\u0430 \u041c\u0435\u0434\u0435\u0440\u043e\u0432\u0430, 161\u0430");
  const [comment, setComment] = useState("");
  const [coords, setCoords] = useState<LatLng | null>(null);
  const [latInput, setLatInput] = useState("");
  const [lngInput, setLngInput] = useState("");
  const [mapError, setMapError] = useState<string | null>(null);
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("SUPPLIER_COURIER");

  const itemsCount = useMemo(() => items.reduce((acc, it) => acc + it.qty, 0), [items]);
  const canCheckout = !creating && itemsCount > 0 && Boolean(buyerCompanyId);
  const canSubmitOrder = canCheckout && address.trim().length > 0;

  const syncCoordsFromInputs = (nextLatRaw: string, nextLngRaw: string) => {
    const lat = Number(nextLatRaw.replace(",", "."));
    const lng = Number(nextLngRaw.replace(",", "."));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setCoords(null);
      return;
    }
    const next = { lat, lng };
    if (!isValidLatLng(next)) {
      setCoords(null);
      return;
    }
    setCoords(next);
  };

  const applyCoords = (next: LatLng | null) => {
    setCoords(next);
    setLatInput(next ? next.lat.toFixed(6) : "");
    setLngInput(next ? next.lng.toFixed(6) : "");
  };

  const submitOrder = async () => {
    if (!canSubmitOrder) return;

    const supplierIds = Array.from(
      new Set(
        items
          .map((it) => it.product.supplier_company_id)
          .filter((x): x is number => typeof x === "number" && !Number.isNaN(x))
      )
    );

    if (supplierIds.length === 0) {
      onNotify(
        "\u041d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d supplier_company_id \u0443 \u0442\u043e\u0432\u0430\u0440\u043e\u0432. \u041e\u0447\u0438\u0441\u0442\u0438\u0442\u0435 \u043a\u043e\u0440\u0437\u0438\u043d\u0443 \u0438 \u0434\u043e\u0431\u0430\u0432\u044c\u0442\u0435 \u0442\u043e\u0432\u0430\u0440\u044b \u0437\u0430\u043d\u043e\u0432\u043e.",
        "error"
      );
      return;
    }
    if (supplierIds.length > 1) {
      onNotify(
        "\u041f\u043e\u043a\u0430 \u043c\u043e\u0436\u043d\u043e \u043e\u0444\u043e\u0440\u043c\u0438\u0442\u044c \u0437\u0430\u043a\u0430\u0437 \u0442\u043e\u043b\u044c\u043a\u043e \u0443 \u043e\u0434\u043d\u043e\u0433\u043e \u043f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0430 \u0437\u0430 \u0440\u0430\u0437.",
        "error"
      );
      return;
    }

    const finalComment = appendGeoTag(comment, coords);

    try {
      setCreating(true);
      await createOrder({
        delivery_address: address.trim(),
        comment: finalComment,
        buyer_company_id: Number(buyerCompanyId),
        supplier_company_id: supplierIds[0],
        delivery_mode: deliveryMode,
        items: items.map((it) => ({
          product_id: Number(it.product.id),
          qty: it.qty,
        })),
      });

      onClear();
      setCheckoutOpen(false);
      onCheckoutSuccess();
      onNotify("\u0417\u0430\u043a\u0430\u0437 \u0443\u0441\u043f\u0435\u0448\u043d\u043e \u0441\u043e\u0437\u0434\u0430\u043d", "success");
    } catch (e) {
      logger.error(e);
      onNotify(
        "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0437\u0434\u0430\u0442\u044c \u0437\u0430\u043a\u0430\u0437. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 backend /api/orders/create/",
        "error"
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <section id="screen-cart" data-testid="screen-cart" className={`screen ${active ? "active" : ""}`}>
      <TopHeader onBurger={onBurger} badgeCount={cartCount} />

      <header className="simple-header cart-header-modern">
        <div className="simple-title">{"\u041a\u043e\u0440\u0437\u0438\u043d\u0430"}</div>
        <div className="cart-header-subtitle">
          {itemsCount > 0
            ? `${itemsCount} \u0442\u043e\u0432\u0430\u0440\u043e\u0432 \u0432 \u0437\u0430\u043a\u0430\u0437\u0435`
            : "\u0414\u043e\u0431\u0430\u0432\u044c\u0442\u0435 \u0442\u043e\u0432\u0430\u0440\u044b \u0441 \u0432\u0438\u0442\u0440\u0438\u043d\u044b"}
        </div>
      </header>

      <div className="cart-content cart-content-modern">
        {items.length === 0 ? (
          <div className="cart-empty cart-empty-modern">
            <div className="cart-empty-icon">{"\ud83e\uddfa"}</div>
            <div className="cart-empty-title">{"\u041a\u043e\u0440\u0437\u0438\u043d\u0430 \u043f\u043e\u043a\u0430 \u043f\u0443\u0441\u0442\u0430\u044f"}</div>
            <div className="cart-empty-text">
              {
                "\u0414\u043e\u0431\u0430\u0432\u044c\u0442\u0435 \u0442\u043e\u0432\u0430\u0440\u044b \u0441 \u0433\u043b\u0430\u0432\u043d\u043e\u0439 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u044b USC, \u0447\u0442\u043e\u0431\u044b \u0441\u043e\u0431\u0440\u0430\u0442\u044c \u0437\u0430\u043a\u0430\u0437 \u0438 \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u0435\u0433\u043e \u043f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0443."
              }
            </div>
          </div>
        ) : (
          <>
            <div className="cart-toolbar">
              <div className="cart-chip">{`\u041f\u043e\u0437\u0438\u0446\u0438\u0439: ${items.length}`}</div>
              <div className="cart-chip">{`\u0421\u0443\u043c\u043c\u0430\u0440\u043d\u043e: ${itemsCount} \u0448\u0442.`}</div>
              <button className="cart-clear" type="button" onClick={onClear} disabled={creating}>
                {"\u041e\u0447\u0438\u0441\u0442\u0438\u0442\u044c"}
              </button>
            </div>

            <div className="cart-items">
              {items.map((it) => {
                const price = Number(it.product.price) || 0;
                const subtotal = price * it.qty;

                return (
                  <article className="cart-item cart-item-modern" key={it.product.id}>
                    <img className="cart-item-image" src={it.product.image} alt={it.product.name} />

                    <div className="cart-item-main">
                      <div className="cart-item-title">{it.product.name}</div>
                      <div className="cart-item-seller">{it.product.seller}</div>

                      <div className="cart-item-row2">
                        <div className="cart-item-price">
                          {price > 0 ? `${price} \u0441\u043e\u043c / \u0448\u0442.` : "\u0426\u0435\u043d\u0430 \u043f\u043e \u0437\u0430\u043f\u0440\u043e\u0441\u0443"}
                        </div>
                        <div className="cart-item-subtotal">{subtotal > 0 ? `${subtotal} \u0441\u043e\u043c` : "\u2014"}</div>
                      </div>

                      <div className="cart-item-footer">
                        <div className="cart-item-qty">
                          <button
                            className="qty-btn qty-btn-light"
                            type="button"
                            onClick={() => onDec(it.product.id)}
                            disabled={it.qty <= 1 || creating}
                            title={"\u041c\u0438\u043d\u0443\u0441"}
                          >
                            {"\u2212"}
                          </button>
                          <div className="qty-value">{it.qty}</div>
                          <button
                            className="qty-btn"
                            type="button"
                            onClick={() => onInc(it.product.id)}
                            title={"\u041f\u043b\u044e\u0441"}
                            disabled={creating}
                          >
                            +
                          </button>
                        </div>

                        <button
                          className="cart-item-remove"
                          type="button"
                          onClick={() => onRemove(it.product.id)}
                          title={"\u0423\u0434\u0430\u043b\u0438\u0442\u044c"}
                          aria-label={"\u0423\u0434\u0430\u043b\u0438\u0442\u044c"}
                          disabled={creating}
                        >
                          {"\u0423\u0434\u0430\u043b\u0438\u0442\u044c"}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="cart-sticky-checkout">
              <div className="cart-sticky-top">
                <div>
                  <div className="cart-sticky-label">{"\u0418\u0442\u043e\u0433\u043e"}</div>
                  <div className="cart-sticky-amount">{`${total} \u0441\u043e\u043c`}</div>
                </div>
                <div className={`cart-company-state ${buyerCompanyId ? "ok" : "warn"}`}>
                  {buyerCompanyId
                    ? "\u041a\u043e\u043c\u043f\u0430\u043d\u0438\u044f \u0432\u044b\u0431\u0440\u0430\u043d\u0430"
                    : "\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043a\u043e\u043c\u043f\u0430\u043d\u0438\u044e"}
                </div>
              </div>

              <button
                className="primary-button cart-checkout"
                data-testid="cart-open-checkout"
                type="button"
                onClick={() => setCheckoutOpen((v) => !v)}
                disabled={!canCheckout}
              >
                {checkoutOpen
                  ? "\u0421\u043a\u0440\u044b\u0442\u044c \u043e\u0444\u043e\u0440\u043c\u043b\u0435\u043d\u0438\u0435"
                  : "\u041f\u0435\u0440\u0435\u0439\u0442\u0438 \u043a \u043e\u0444\u043e\u0440\u043c\u043b\u0435\u043d\u0438\u044e"}
              </button>
            </div>

            {checkoutOpen && (
              <section className="checkout-inline">
                <div className="checkout-inline-title">{"\u041e\u0444\u043e\u0440\u043c\u043b\u0435\u043d\u0438\u0435 \u0437\u0430\u043a\u0430\u0437\u0430"}</div>

                <label className="field">
                  <div className="field-label">{"\u0410\u0434\u0440\u0435\u0441 \u0434\u043e\u0441\u0442\u0430\u0432\u043a\u0438"}</div>
                  <input
                    className="field-input"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder={"\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0430\u0434\u0440\u0435\u0441"}
                    disabled={creating}
                  />
                </label>

                <div className="field">
                  <div className="field-label">{"\u041a\u043e\u043e\u0440\u0434\u0438\u043d\u0430\u0442\u044b (\u043e\u043f\u0446\u0438\u043e\u043d\u0430\u043b\u044c\u043d\u043e)"}</div>
                  <MapPicker
                    value={coords}
                    disabled={creating}
                    onChange={(next) => {
                      applyCoords(next);
                      setMapError(null);
                    }}
                    onError={(message) => setMapError(message)}
                  />
                  <div className="coords-row">
                    <input
                      className="field-input"
                      placeholder={"\u0428\u0438\u0440\u043e\u0442\u0430"}
                      value={latInput}
                      onChange={(e) => {
                        const nextLat = e.target.value;
                        setLatInput(nextLat);
                        syncCoordsFromInputs(nextLat, lngInput);
                      }}
                      disabled={creating}
                    />
                    <input
                      className="field-input"
                      placeholder={"\u0414\u043e\u043b\u0433\u043e\u0442\u0430"}
                      value={lngInput}
                      onChange={(e) => {
                        const nextLng = e.target.value;
                        setLngInput(nextLng);
                        syncCoordsFromInputs(latInput, nextLng);
                      }}
                      disabled={creating}
                    />
                  </div>

                  <div className="map-actions">
                    <span className={`map-badge ${coords ? "ok" : ""}`}>
                      {coords ? "\u0422\u043e\u0447\u043a\u0430 \u0432\u044b\u0431\u0440\u0430\u043d\u0430" : "\u0422\u043e\u0447\u043a\u0430 \u043d\u0435 \u0432\u044b\u0431\u0440\u0430\u043d\u0430"}
                    </span>
                    <button
                      className="btn-secondary"
                      type="button"
                      disabled={creating || !navigator.geolocation}
                      onClick={() => {
                        if (!navigator.geolocation) return;
                        navigator.geolocation.getCurrentPosition(
                          (pos) => {
                            applyCoords({
                              lat: Number(pos.coords.latitude.toFixed(6)),
                              lng: Number(pos.coords.longitude.toFixed(6)),
                            });
                            setMapError(null);
                          },
                          () => {
                            // ignore geolocation errors
                          }
                        );
                      }}
                    >
                      {"\u041e\u043f\u0440\u0435\u0434\u0435\u043b\u0438\u0442\u044c \u043c\u043e\u044e \u0433\u0435\u043e\u043f\u043e\u0437\u0438\u0446\u0438\u044e"}
                    </button>
                  </div>
                  {mapError ? <div className="map-hint map-error">{mapError}</div> : null}
                </div>

                <label className="field">
                  <div className="field-label">{"\u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0439 \u043a \u0437\u0430\u043a\u0430\u0437\u0443"}</div>
                  <input
                    className="field-input"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder={"\u041d\u0430\u043f\u0440\u0438\u043c\u0435\u0440: \u043f\u043e\u0437\u0432\u043e\u043d\u0438\u0442\u044c \u0437\u0430 10 \u043c\u0438\u043d\u0443\u0442"}
                    disabled={creating}
                  />
                </label>

                <label className="field">
                  <div className="field-label">{"\u0422\u0438\u043f \u0434\u043e\u0441\u0442\u0430\u0432\u043a\u0438"}</div>
                  <select
                    className="field-input"
                    value={deliveryMode}
                    onChange={(e) => setDeliveryMode(e.target.value as DeliveryMode)}
                    disabled={creating}
                  >
                    <option value="SUPPLIER_COURIER">{"\u041a\u0443\u0440\u044c\u0435\u0440 \u043f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0430"}</option>
                    <option value="BUYER_COURIER">{"\u0421\u0432\u043e\u0439 \u043a\u0443\u0440\u044c\u0435\u0440"}</option>
                    <option value="YANDEX">{"\u0412\u043d\u0435\u0448\u043d\u044f\u044f \u0434\u043e\u0441\u0442\u0430\u0432\u043a\u0430 (Yandex)"}</option>
                  </select>
                </label>

                <div className="checkout-inline-actions">
                  <button className="btn-secondary" type="button" onClick={() => setCheckoutOpen(false)} disabled={creating}>
                    {"\u041e\u0442\u043c\u0435\u043d\u0430"}
                  </button>
                  <button className="btn-primary" data-testid="cart-create-order" type="button" onClick={submitOrder} disabled={!canSubmitOrder}>
                    {creating ? "\u0421\u043e\u0437\u0434\u0430\u044e..." : "\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u0437\u0430\u043a\u0430\u0437"}
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </section>
  );
}



