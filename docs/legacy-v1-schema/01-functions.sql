CREATE OR REPLACE FUNCTION public.increment_account_sent_safe(account_id uuid, amount integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare
  current_sent int;
  limit_val int;
begin
  select sent_today, daily_limit into current_sent, limit_val
  from gmail_accounts where id = account_id;

  -- Check if adding this batch would exceed the limit
  if (current_sent + amount) > limit_val then
    return false;
  end if;

  update gmail_accounts
  set 
    sent_today = sent_today + amount,
    last_sent_at = now()
  where id = account_id;

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lock_recipients_for_batch(p_campaign_id uuid, p_account_id uuid, p_limit integer)
 RETURNS TABLE(id uuid, email text, campaign_id uuid)
 LANGUAGE plpgsql
AS $function$
begin
  return query
  update recipients
  set status = 'processing'
  where id in (
    select r.id
    from recipients r
    join campaigns c on c.id = r.campaign_id
    where r.campaign_id = p_campaign_id
      and r.assigned_gmail_account_id = p_account_id
      and r.status = 'pending'
      and c.status = 'running'
    limit p_limit
    for update skip locked
  )
  returning recipients.id, recipients.email, recipients.campaign_id;
end;
$function$
;
