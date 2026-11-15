import { motion } from "framer-motion"

/**
 * Soft public takedown page. Report app code is fully retained —
 * flip SITE_AVAILABLE in App.tsx to restore.
 */
export default function ComingSoon() {
  return (
    <div className="coming-soon">
      <motion.div
        className="coming-soon-grid"
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.22 }}
        transition={{ duration: 1.2 }}
      />
      <motion.main
        className="coming-soon-inner"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.img
          src={`${import.meta.env.BASE_URL}sir-logo.svg`}
          alt="Sotheby’s International Realty"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.6 }}
        />
        <p className="coming-soon-kicker">CRE Matrix App</p>
        <h1>Coming soon</h1>
        <p className="coming-soon-dek">
          This presentation is temporarily offline. Please check back shortly.
        </p>
      </motion.main>
    </div>
  )
}
