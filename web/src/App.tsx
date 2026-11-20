import { Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import Overview from './pages/Overview'
import Tables from './pages/Tables'
import Patient from './pages/Patient'
import Dictionary from './pages/Dictionary'
import SqlWorkbench from './pages/SqlWorkbench'
import Quality from './pages/Quality'

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Overview />} />
        <Route path="/tables/:table?" element={<Tables />} />
        <Route path="/patient/:subjectId?" element={<Patient />} />
        <Route path="/dictionary" element={<Dictionary />} />
        <Route path="/sql" element={<SqlWorkbench />} />
        <Route path="/quality" element={<Quality />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
