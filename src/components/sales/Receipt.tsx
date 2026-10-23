import { cn } from "@/lib/utils";
import { fmtDateTime, fmtTHB } from "@/lib/format";
import type { Payment, Sale, ShopSettings } from "@/types/domain";
import { PAYMENT_STATUS, SALE_STATUS } from "@/components/common";

export function Receipt({
  sale,
  payment,
  settings,
  employee,
  layout = "thermal",
}: {
  sale: Sale;
  payment?: Payment | undefined;
  settings: ShopSettings;
  employee: string;
  layout?: "thermal" | "page" | undefined;
}) {
  const thermal = layout === "thermal";
  return (
    <div
      className={cn(
        "print-area mx-auto bg-card text-card-foreground",
        thermal
          ? "w-full max-w-[300px] font-mono text-[12px] leading-relaxed"
          : "max-w-2xl p-2 text-sm",
      )}
    >
      <div
        className={cn(thermal ? "text-center" : "flex items-start justify-between border-b pb-4")}
      >
        <div>
          <div className={cn("font-semibold", thermal ? "text-sm" : "text-lg")}>
            {settings.shopName}
          </div>
          <div className="text-muted-foreground">{settings.address}</div>
          <div className="text-muted-foreground">Tax ID {settings.taxId}</div>
        </div>
        <div className={cn(thermal ? "mt-2" : "text-right")}>
          <div className="font-semibold">{sale.receiptNo}</div>
          <div className="text-muted-foreground">{fmtDateTime(sale.createdAt)}</div>
          <div className="text-muted-foreground">Staff: {employee}</div>
        </div>
      </div>
      {sale.status !== "completed" && (
        <div className="my-2 border border-dashed py-1 text-center font-semibold uppercase">
          {SALE_STATUS[sale.status].label}
        </div>
      )}
      <div className={cn("my-3", thermal ? "border-y border-dashed py-2" : "")}>
        {!thermal && (
          <div className="grid grid-cols-[1fr_60px_90px_90px] border-b py-1.5 text-xs text-muted-foreground">
            <span>Item</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Unit</span>
            <span className="text-right">Amount</span>
          </div>
        )}
        {sale.items.map((i) =>
          thermal ? (
            <div key={i.variantId} className="mb-1">
              <div>{i.name}</div>
              <div className="flex justify-between text-muted-foreground">
                <span>
                  {i.variantLabel}
                  {settings.showSkuOnReceipt ? ` · ${i.sku}` : ""}
                </span>
              </div>
              <div className="num flex justify-between">
                <span>
                  {i.qty} × {fmtTHB(i.unitPrice)}
                </span>
                <span>{fmtTHB(i.qty * i.unitPrice)}</span>
              </div>
              {i.lineDiscount > 0 && (
                <div className="num flex justify-between text-muted-foreground">
                  <span>Normal {fmtTHB(i.listPrice)}</span>
                  <span>−{fmtTHB(i.lineDiscount)}</span>
                </div>
              )}
            </div>
          ) : (
            <div
              key={i.variantId}
              className="num grid grid-cols-[1fr_60px_90px_90px] border-b py-2"
            >
              <span>
                {i.name}{" "}
                <span className="text-xs text-muted-foreground">
                  {i.variantLabel}
                  {settings.showSkuOnReceipt ? ` · ${i.sku}` : ""}
                </span>
                {i.lineDiscount > 0 && (
                  <span className="block text-xs text-muted-foreground">
                    Normal {fmtTHB(i.listPrice)} · reduced −{fmtTHB(i.lineDiscount)}
                  </span>
                )}
              </span>
              <span className="text-right">{i.qty}</span>
              <span className="text-right">{fmtTHB(i.unitPrice)}</span>
              <span className="text-right">{fmtTHB(i.qty * i.unitPrice)}</span>
            </div>
          ),
        )}
      </div>
      <div className={cn("num space-y-0.5", !thermal && "ml-auto w-64")}>
        <L k="Subtotal" v={fmtTHB(sale.subtotal)} />
        {sale.discount > 0 && <L k="Discount" v={`−${fmtTHB(sale.discount)}`} />}
        <L k="Total" v={fmtTHB(sale.total)} bold />
        <L k="Payment" v={sale.paymentMethod === "cash" ? "Cash" : "QR / transfer"} />
        {sale.cashReceived !== undefined && <L k="Received" v={fmtTHB(sale.cashReceived)} />}
        {sale.change !== undefined && <L k="Change" v={fmtTHB(sale.change)} />}
        {payment?.reference && <L k="Reference" v={payment.reference} />}
        {payment && sale.paymentMethod === "qr" && (
          <L k="Status" v={PAYMENT_STATUS[payment.status].label} />
        )}
      </div>
      <p className={cn("mt-4 text-muted-foreground", thermal && "text-center")}>
        {settings.receiptFooter}
      </p>
      <p className={cn("mt-1 text-[10px] text-muted-foreground", thermal && "text-center")}>
        DEMO RECEIPT — not a tax invoice
      </p>
    </div>
  );
}

function L({ k, v, bold }: { k: string; v: string; bold?: boolean | undefined }) {
  return (
    <div
      className={cn("flex justify-between", bold && "border-t border-dashed pt-1 font-semibold")}
    >
      <span>{k}</span>
      <span>{v}</span>
    </div>
  );
}
