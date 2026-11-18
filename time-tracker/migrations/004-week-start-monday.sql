UPDATE timesheets
  SET week_start = date(week_start, '+1 day'),
      updated_at = datetime('now')
  WHERE CAST(strftime('%w', week_start) AS INTEGER) = 0;
