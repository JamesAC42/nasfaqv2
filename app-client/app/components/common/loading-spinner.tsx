import styles from "@/app/components/common/loading-spinner.module.scss";

type LoadingSpinnerProps = {
  className?: string;
  label?: string;
};

export function LoadingSpinner({ className = "", label = "Loading" }: LoadingSpinnerProps) {
  return (
    <div className={`${styles.spinner} ${className}`.trim()} role="status" aria-live="polite" aria-label={label}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        className={styles.icon}
        aria-hidden="true"
        focusable="false"
      >
        <rect width="2.8" height="12" x="1" y="6" fill="currentColor">
          <animate
            id="loadingSpinnerBarStart"
            attributeName="y"
            begin="0;loadingSpinnerBarEnd.end-0.1s"
            calcMode="spline"
            dur="0.6s"
            keySplines=".36,.61,.3,.98;.36,.61,.3,.98"
            values="6;1;6"
          />
          <animate
            attributeName="height"
            begin="0;loadingSpinnerBarEnd.end-0.1s"
            calcMode="spline"
            dur="0.6s"
            keySplines=".36,.61,.3,.98;.36,.61,.3,.98"
            values="12;22;12"
          />
        </rect>
        <rect width="2.8" height="12" x="5.8" y="6" fill="currentColor">
          <animate
            attributeName="y"
            begin="loadingSpinnerBarStart.begin+0.1s"
            calcMode="spline"
            dur="0.6s"
            keySplines=".36,.61,.3,.98;.36,.61,.3,.98"
            values="6;1;6"
          />
          <animate
            attributeName="height"
            begin="loadingSpinnerBarStart.begin+0.1s"
            calcMode="spline"
            dur="0.6s"
            keySplines=".36,.61,.3,.98;.36,.61,.3,.98"
            values="12;22;12"
          />
        </rect>
        <rect width="2.8" height="12" x="10.6" y="6" fill="currentColor">
          <animate
            attributeName="y"
            begin="loadingSpinnerBarStart.begin+0.2s"
            calcMode="spline"
            dur="0.6s"
            keySplines=".36,.61,.3,.98;.36,.61,.3,.98"
            values="6;1;6"
          />
          <animate
            attributeName="height"
            begin="loadingSpinnerBarStart.begin+0.2s"
            calcMode="spline"
            dur="0.6s"
            keySplines=".36,.61,.3,.98;.36,.61,.3,.98"
            values="12;22;12"
          />
        </rect>
        <rect width="2.8" height="12" x="15.4" y="6" fill="currentColor">
          <animate
            attributeName="y"
            begin="loadingSpinnerBarStart.begin+0.3s"
            calcMode="spline"
            dur="0.6s"
            keySplines=".36,.61,.3,.98;.36,.61,.3,.98"
            values="6;1;6"
          />
          <animate
            attributeName="height"
            begin="loadingSpinnerBarStart.begin+0.3s"
            calcMode="spline"
            dur="0.6s"
            keySplines=".36,.61,.3,.98;.36,.61,.3,.98"
            values="12;22;12"
          />
        </rect>
        <rect width="2.8" height="12" x="20.2" y="6" fill="currentColor">
          <animate
            id="loadingSpinnerBarEnd"
            attributeName="y"
            begin="loadingSpinnerBarStart.begin+0.4s"
            calcMode="spline"
            dur="0.6s"
            keySplines=".36,.61,.3,.98;.36,.61,.3,.98"
            values="6;1;6"
          />
          <animate
            attributeName="height"
            begin="loadingSpinnerBarStart.begin+0.4s"
            calcMode="spline"
            dur="0.6s"
            keySplines=".36,.61,.3,.98;.36,.61,.3,.98"
            values="12;22;12"
          />
        </rect>
      </svg>
      <span className={styles.label}>{label}</span>
    </div>
  );
}