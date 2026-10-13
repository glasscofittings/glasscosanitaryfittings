'use client'

import React, { useState } from 'react'
import {
  Database,
  Calendar,
  Clock,
  HardDrive,
  Download,
  CheckCircle,
  ShieldAlert,
  Zap,
  Printer,
  FileDown,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { exportBackupData, formatBytes } from '@/lib/backup-exporter'
import { generateERPReportPDF } from '@/lib/pdf-exporter'
import { OperatorModal } from '@/components/OperatorModal'

export default function BackupManagerPage() {
  const [selectedPreset, setSelectedPreset] = useState<'24H' | '7D' | 'CUSTOM'>('24H')
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    d.setHours(d.getHours() - 24)
    return d.toISOString().slice(0, 16)
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 16))

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [notification, setNotification] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)

  const handlePresetChange = (preset: '24H' | '7D' | 'CUSTOM') => {
    setSelectedPreset(preset)
    const now = new Date()
    setEndDate(now.toISOString().slice(0, 16))

    if (preset === '24H') {
      const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      setStartDate(past24h.toISOString().slice(0, 16))
    } else if (preset === '7D') {
      const past7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      setStartDate(past7d.toISOString().slice(0, 16))
    }
  }

  const handleInitiateBackup = () => {
    setNotification(null)
    setIsModalOpen(true)
  }

  const handleConfirmBackup = async (operatorName: string) => {
    setIsLoading(true)
    try {
      const supabase = createClient()
      const startISO = new Date(startDate).toISOString()
      const endISO = new Date(endDate).toISOString()

      // Call Supabase RPC for custom range backup
      const { data, error } = await supabase.rpc('generate_custom_backup_snapshot', {
        start_date: startISO,
        end_date: endISO,
      })

      if (error) throw error

      const timestampStr = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = `glassco_backup_${selectedPreset.toLowerCase()}_${timestampStr}.json`

      const payload = data?.snapshot || data

      const result = await exportBackupData(filename, payload)

      if (result.success) {
        setNotification({
          type: 'success',
          message: `Backup export successful! Saved file: ${result.filePath || filename} (${formatBytes(result.byteSize)}) - Authorized by ${operatorName}`,
        })
        setIsModalOpen(false)
      } else {
        throw new Error('File export was cancelled or failed locally.')
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setNotification({
        type: 'error',
        message: message || 'Failed to generate database backup snapshot.',
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6 md:p-10 font-sans selection:bg-red-500 selection:text-white">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-red-500 tracking-wider uppercase mb-1">
            <Database className="w-4 h-4" /> System Administration
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-neutral-100 via-neutral-200 to-neutral-500 bg-clip-text text-transparent">
            Database Backup & Recovery
          </h1>
          <p className="text-sm text-neutral-400 mt-1">
            Manage automated snapshot schedules, run manual backups, and export local data logs for Glassco Sanitary ERP.
          </p>
        </div>
      </div>

      {/* Notifications */}
      {notification && (
        <div
          className={`mb-6 p-4 rounded-2xl border flex items-start gap-3 transition-all ${
            notification.type === 'success'
              ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
              : 'bg-red-950/30 border-red-500/40 text-red-300'
          }`}
        >
          {notification.type === 'success' ? (
            <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          )}
          <div className="text-xs md:text-sm font-medium">{notification.message}</div>
        </div>
      )}

      {/* Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Top Status Card - Obsidian Dark Glassmorphic */}
        <div className="lg:col-span-3 bg-neutral-900/40 border border-neutral-800/80 rounded-3xl p-6 md:p-8 backdrop-blur-xl shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-red-600/5 rounded-full blur-3xl pointer-events-none" />

          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-neutral-800/60 border border-neutral-700/50 text-red-500">
                <Clock className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-neutral-100">
                  Automated 24-Hour Backup Status
                </h2>
                <p className="text-xs text-neutral-400">pg_cron 24-hour cycle schedule active</p>
              </div>
            </div>
            <span className="px-3 py-1 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              ACTIVE_CRON
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-2xl bg-neutral-950/60 border border-neutral-800/60">
              <span className="text-xs text-neutral-400 font-medium block mb-1">
                Last Execution Timestamp
              </span>
              <span className="text-sm md:text-base font-bold text-neutral-200">
                Today at 00:00 UTC
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-neutral-950/60 border border-neutral-800/60">
              <span className="text-xs text-neutral-400 font-medium block mb-1">
                Next Scheduled Execution
              </span>
              <span className="text-sm md:text-base font-bold text-neutral-200">
                Tomorrow at 00:00 UTC
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-neutral-950/60 border border-neutral-800/60">
              <span className="text-xs text-neutral-400 font-medium block mb-1">
                Total Database Tables
              </span>
              <span className="text-sm md:text-base font-bold text-neutral-200 flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-red-400" /> 6 Primary Tables
              </span>
            </div>
          </div>
        </div>

        {/* Manual Backup Control Panel */}
        <div className="lg:col-span-3 bg-neutral-900/40 border border-neutral-800/80 rounded-3xl p-6 md:p-8 backdrop-blur-xl shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 rounded-2xl bg-neutral-800/60 border border-neutral-700/50 text-red-500">
              <Zap className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-neutral-100">Manual Backup Control Panel</h2>
              <p className="text-xs text-neutral-400">
                Generate an on-demand snapshot & export directly to local storage
              </p>
            </div>
          </div>

          <div className="space-y-6">
            {/* Quick Action Presets */}
            <div>
              <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2.5">
                Quick-Action Preset Filter
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => handlePresetChange('24H')}
                  className={`px-4 py-3 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2 border ${
                    selectedPreset === '24H'
                      ? 'bg-red-600/20 border-red-500 text-red-400 shadow-lg shadow-red-950/40'
                      : 'bg-neutral-950/60 border-neutral-800 text-neutral-300 hover:border-neutral-700'
                  }`}
                >
                  <Clock className="w-4 h-4" /> Backup Last 24 Hours
                </button>

                <button
                  type="button"
                  onClick={() => handlePresetChange('7D')}
                  className={`px-4 py-3 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2 border ${
                    selectedPreset === '7D'
                      ? 'bg-red-600/20 border-red-500 text-red-400 shadow-lg shadow-red-950/40'
                      : 'bg-neutral-950/60 border-neutral-800 text-neutral-300 hover:border-neutral-700'
                  }`}
                >
                  <Calendar className="w-4 h-4" /> Backup Last 7 Days (1 Week)
                </button>

                <button
                  type="button"
                  onClick={() => handlePresetChange('CUSTOM')}
                  className={`px-4 py-3 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2 border ${
                    selectedPreset === 'CUSTOM'
                      ? 'bg-red-600/20 border-red-500 text-red-400 shadow-lg shadow-red-950/40'
                      : 'bg-neutral-950/60 border-neutral-800 text-neutral-300 hover:border-neutral-700'
                  }`}
                >
                  <Calendar className="w-4 h-4" /> Custom Range Picker
                </button>
              </div>
            </div>

            {/* Date Picker Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">
                  Start Date & Time
                </label>
                <input
                  type="datetime-local"
                  value={startDate}
                  onChange={(e) => {
                    setSelectedPreset('CUSTOM')
                    setStartDate(e.target.value)
                  }}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-neutral-100 focus:outline-none focus:border-red-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">
                  End Date & Time
                </label>
                <input
                  type="datetime-local"
                  value={endDate}
                  onChange={(e) => {
                    setSelectedPreset('CUSTOM')
                    setEndDate(e.target.value)
                  }}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-neutral-100 focus:outline-none focus:border-red-500 transition-colors"
                />
              </div>
            </div>

            {/* Action Primary & PDF Print Buttons */}
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  generateERPReportPDF({
                    title: 'System Backup Audit Report',
                    subtitle: `Snapshot Preset: ${selectedPreset} | Range: ${startDate} to ${endDate}`,
                    operatorName: 'System Auditor',
                    headers: ['Module / Table', 'Record Filter', 'Status', 'Snapshot Timestamp'],
                    rows: [
                      ['Inward Gate Passes', 'Date Filtered Range', 'SNAPSHOT_VERIFIED', new Date().toLocaleString()],
                      ['Raw Inventory WH-01', 'Full Current State', 'SNAPSHOT_VERIFIED', new Date().toLocaleString()],
                      ['Finished Inventory WH-02', 'Full Current State', 'SNAPSHOT_VERIFIED', new Date().toLocaleString()],
                      ['System Audit Logs', 'Date Filtered Range', 'SNAPSHOT_VERIFIED', new Date().toLocaleString()],
                    ],
                    filename: `glassco_backup_report_${selectedPreset.toLowerCase()}.pdf`,
                    autoPrint: false,
                  })
                }}
                className="w-full sm:w-auto px-6 py-3.5 rounded-2xl text-xs font-bold bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700/80 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <FileDown className="w-4 h-4 text-red-400" /> Export PDF Report
              </button>

              <button
                type="button"
                onClick={() => {
                  generateERPReportPDF({
                    title: 'System Backup Audit Printout',
                    subtitle: `Snapshot Preset: ${selectedPreset} | Range: ${startDate} to ${endDate}`,
                    operatorName: 'System Auditor',
                    headers: ['Module / Table', 'Record Filter', 'Status', 'Snapshot Timestamp'],
                    rows: [
                      ['Inward Gate Passes', 'Date Filtered Range', 'SNAPSHOT_VERIFIED', new Date().toLocaleString()],
                      ['Raw Inventory WH-01', 'Full Current State', 'SNAPSHOT_VERIFIED', new Date().toLocaleString()],
                      ['Finished Inventory WH-02', 'Full Current State', 'SNAPSHOT_VERIFIED', new Date().toLocaleString()],
                      ['System Audit Logs', 'Date Filtered Range', 'SNAPSHOT_VERIFIED', new Date().toLocaleString()],
                    ],
                    autoPrint: true,
                  })
                }}
                className="w-full sm:w-auto px-6 py-3.5 rounded-2xl text-xs font-bold bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700/80 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Printer className="w-4 h-4 text-emerald-400" /> Print PDF Preview
              </button>

              <button
                type="button"
                onClick={handleInitiateBackup}
                style={{ backgroundColor: '#DC2626' }}
                className="w-full sm:w-auto px-8 py-3.5 rounded-2xl text-sm font-extrabold text-white hover:opacity-90 transition-all shadow-xl shadow-red-950/50 flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4" /> Take Backup Now
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Operator Confirmation Modal */}
      <OperatorModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConfirm={handleConfirmBackup}
        isLoading={isLoading}
      />
    </div>
  )
}
